'use strict';

const { Op } = require('sequelize');
const db = require('../../models');
const AppError = require('../../utils/AppError');
const socketGateway = require('../../providers/socket/socket.gateway');
const chatwootClient = require('../../providers/chatwoot/chatwoot.client');

const QUEUE_MESSAGES = require('./queue.constants');

const {
  sequelize,
  Queue,
  Session,
  Specialist,
  Client,
  User,
} = db;

const DEFAULT_AVG_SESSION_MINUTES = 15;
const SESSION_SAMPLE_LIMIT = 10;

const SESSION_MODALITIES = ['TEXTO', 'VOZ', 'VIDEO'];
const TELECOM_BUSY_STATUSES = ['PENDING', 'ACTIVE', 'WARNING'];

function resolveClientFriendlyName(clientRow) {
  if (!clientRow) return 'Cliente';
  const nome = `${clientRow.nome ?? ''}`.trim();
  const tratar = `${clientRow.tratar_por ?? ''}`.trim();
  const nick = `${clientRow.nickname ?? ''}`.trim();
  return nome || tratar || nick || 'Cliente';
}

async function postPrivateNoteForQueueInvite(inviteRowPlain, specialistDisplayName, clientFriendlyName) {
  const accountId = `${process.env.CHATWOOT_ACCOUNT_ID ?? ''}`.trim();
  if (!accountId) {
    console.warn('[Queue:Chatwoot] CHATWOOT_ACCOUNT_ID não definido — nota à equipa ignorada.');
    return;
  }

  const joinedMs = inviteRowPlain.joined_at ? new Date(inviteRowPlain.joined_at).getTime() : NaN;
  const waitMinutes = Number.isFinite(joinedMs)
    ? Math.max(1, Math.ceil((Date.now() - joinedMs) / 60_000))
    : 1;

  const content = QUEUE_MESSAGES.formatQueueTemplate(QUEUE_MESSAGES.MSG_PRIVATE_NOTE_ATTENDANT, {
    specialist_name: specialistDisplayName || 'Especialista',
    client_name: clientFriendlyName,
    wait_time: waitMinutes,
  });

  const userRow = await User.findByPk(inviteRowPlain.user_id_for_chatwoot, {
    attributes: ['id', 'chatwoot_conversation_id'],
    paranoid: true,
  });

  const convId = `${userRow?.chatwoot_conversation_id ?? ''}`.trim();
  if (!convId) {
    console.warn('[Queue:Chatwoot] Sem chatwoot_conversation_id — nota privada não enviada.', {
      user_id: inviteRowPlain.user_id_for_chatwoot,
      queue_id: inviteRowPlain.id,
    });
    return;
  }

  try {
    await chatwootClient.postPrivateNote(accountId, convId, content);
    console.log('[Queue:Chatwoot] Nota privada à equipa enviada.', {
      queue_id: inviteRowPlain.id,
      conversation_id: convId,
    });
  } catch (err) {
    console.error('[Queue:Chatwoot] Falha ao criar nota privada:', err?.response?.data || err?.message || err);
  }
}

function specialistStatusesAllowQueue(status) {
  const s = `${status ?? ''}`.trim().toUpperCase();
  return s === 'EM_ATENDIMENTO' || s === 'AUSENTE';
}

/**
 * Fila sanitizada para eventos públicos e `GET /specialist/:id`.
 */
async function buildPublicWaitingSnapshot(specialistId) {
  const rows = await Queue.findAll({
    where: { specialist_id: specialistId, status: 'WAITING' },
    attributes: ['id', 'preferred_modality', 'joined_at'],
    order: [['joined_at', 'ASC']],
    paranoid: true,
  });

  let position = 0;
  return rows.map((r) => ({
    queue_id: r.id,
    position: ++position,
    preferred_modality: r.preferred_modality,
    joined_at: r.joined_at,
  }));
}

async function averageCompletedTelecomMinutesForSpecialist(specialistId) {
  const rows = await Session.findAll({
    where: {
      specialist_id: specialistId,
      telecom_status: 'COMPLETED',
    },
    attributes: ['started_at', 'ended_at', 'rtc_duration_seconds'],
    order: [['ended_at', 'DESC']],
    limit: SESSION_SAMPLE_LIMIT,
    paranoid: true,
  });

  const durations = [];
  rows.forEach((row) => {
    const plain = row.get({ plain: true });
    let sec =
      plain.rtc_duration_seconds != null ? Number.parseInt(`${plain.rtc_duration_seconds}`, 10) : null;
    if (!Number.isFinite(sec) || sec < 0) {
      const st = plain.started_at ? new Date(plain.started_at).getTime() : NaN;
      const en = plain.ended_at ? new Date(plain.ended_at).getTime() : NaN;
      if (Number.isFinite(st) && Number.isFinite(en) && en >= st) {
        sec = Math.floor((en - st) / 1000);
      }
    }
    if (Number.isFinite(sec) && sec > 0) durations.push(sec);
  });

  if (!durations.length) return DEFAULT_AVG_SESSION_MINUTES;

  const avgSec =
    durations.reduce((a, b) => a + b, 0) / durations.length || DEFAULT_AVG_SESSION_MINUTES * 60;
  return Math.max(1, Math.ceil(avgSec / 60));
}

/**
 * @returns {Promise<{ position: number|null, estimated_wait_minutes: number }>}
 */
async function getQueuePositionAndEta(queueId, specialistId) {
  const row = await Queue.findOne({
    where: { id: queueId, specialist_id: specialistId },
    paranoid: true,
  });

  if (!row) {
    throw new AppError('Registro de fila não encontrado.', 404, null, true);
  }

  const statusUp = `${row.status || ''}`.toUpperCase();
  if (statusUp !== 'WAITING') {
    return {
      position: null,
      estimated_wait_minutes: 0,
    };
  }

  const aheadCount = await Queue.count({
    where: {
      specialist_id: specialistId,
      status: 'WAITING',
      joined_at: { [Op.lt]: row.joined_at },
    },
    paranoid: true,
  });

  const position = aheadCount + 1;
  const avgMin = await averageCompletedTelecomMinutesForSpecialist(specialistId);
  const estimatedWait = aheadCount * avgMin;

  return {
    position,
    estimated_wait_minutes: Math.ceil(estimatedWait),
  };
}

async function notifyQueueSockets(specialistId) {
  const snapshot = {
    specialist_id: specialistId,
    fila_espera: await buildPublicWaitingSnapshot(specialistId),
    timestamp: new Date().toISOString(),
  };
  socketGateway.emitQueueUpdate(specialistId, snapshot);
}

/**
 * Após telecom `COMPLETED`: convida o primeiro `WAITING` e emite sockets.
 */
async function promoteFirstWaitingAfterSessionEnded(specialistId, meta = {}) {
  if (!specialistId) return null;

  const invited = await sequelize.transaction(async (t) => {
    const candidate = await Queue.findOne({
      where: {
        specialist_id: specialistId,
        status: 'WAITING',
      },
      order: [['joined_at', 'ASC']],
      lock: true,
      transaction: t,
      paranoid: true,
    });

    if (!candidate) return null;

    await candidate.update(
      {
        status: 'INVITED',
      },
      { transaction: t }
    );

    return candidate.reload({
      attributes: ['id', 'specialist_id', 'client_id', 'status', 'joined_at'],
      transaction: t,
    });
  });

  if (!invited) return null;

  const plainInvite = invited.get({ plain: true });

  const [clientProf, specialistRow] = await Promise.all([
    Client.findByPk(invited.client_id, {
      attributes: ['id', 'user_id', 'nome', 'tratar_por', 'nickname'],
      paranoid: true,
    }),
    Specialist.findByPk(invited.specialist_id, {
      attributes: ['id', 'display_name'],
      paranoid: true,
    }),
  ]);

  await postPrivateNoteForQueueInvite(
    {
      ...plainInvite,
      user_id_for_chatwoot: clientProf?.user_id ?? null,
    },
    `${specialistRow?.display_name ?? ''}`.trim(),
    resolveClientFriendlyName(clientProf)
  );

  socketGateway.emitTurnStarted(invited.specialist_id, {
    specialist_id: invited.specialist_id,
    queue_id: invited.id,
    client_user_id: clientProf?.user_id ?? null,
    cliente_id: clientProf?.id ?? null,
    prior_session_id: meta.session_id ?? null,
    estado: 'INVITED',
    timestamp: new Date().toISOString(),
  });

  await notifyQueueSockets(invited.specialist_id);
  return plainInvite;
}

async function joinQueueAuthenticatedUser(authUser, body = {}) {
  if (!authUser || authUser.role !== 'CLIENTE') {
    throw new AppError(
      'Apenas utilizadores com perfil de cliente podem entrar na fila.',
      403,
      { codigo: 'QUEUE_CLIENT_ONLY' },
      true
    );
  }

  const specialistId = `${body.specialist_id ?? ''}`.trim();
  const preferredModality = `${body.preferred_modality ?? body.modality ?? ''}`
    .trim()
    .toUpperCase();

  if (!/^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.test(specialistId)) {
    throw new AppError('specialist_id inválido.', 400, null, true);
  }

  if (!SESSION_MODALITIES.includes(preferredModality)) {
    throw new AppError(
      `preferred_modality inválida. Escolha: ${SESSION_MODALITIES.join(', ')}.`,
      400,
      null,
      true
    );
  }

  const clientRow = authUser.client_profile;
  let clientResolved = clientRow;
  if (!clientResolved) {
    clientResolved = await Client.findOne({
      where: { user_id: authUser.id },
      paranoid: true,
    });
  }

  if (!clientResolved?.id) {
    throw new AppError('Cliente não encontrado para este usuário.', 403, null, true);
  }

  const specialist = await Specialist.findByPk(specialistId, {
    attributes: ['id', 'status', 'is_blocked'],
    paranoid: true,
  });

  if (!specialist || specialist.is_blocked) {
    throw new AppError('Especialista não encontrada ou bloqueada.', 404, null, true);
  }

  const st = `${specialist.status ?? ''}`.toUpperCase();
  if (st === 'OFFLINE') {
    throw new AppError('Especialista indisponível (offline). Não há fila neste estado.', 400, null, true);
  }

  if (st === 'ONLINE') {
    throw new AppError(
      'A especialista está disponível neste momento. Inicie a consulta diretamente sem usar a fila.',
      400,
      { codigo: 'QUEUE_NOT_NEEDED_ONLINE_SPECIALIST' },
      true
    );
  }

  if (!specialistStatusesAllowQueue(st)) {
    throw new AppError(
      'Não é possível entrar na fila neste momento para o estado operacional atual da especialista.',
      409,
      { codigo: 'QUEUE_UNAVAILABLE_STATE', status_tarologa: st },
      true
    );
  }

  const existing = await Queue.findOne({
    where: {
      client_id: clientResolved.id,
      specialist_id: specialistId,
      status: 'WAITING',
    },
    paranoid: true,
  });

  const queueRow =
    existing ??
    (
      await Queue.create({
        client_id: clientResolved.id,
        specialist_id: specialistId,
        status: 'WAITING',
        preferred_modality: preferredModality,
      })
    );

  if (
    `${queueRow.preferred_modality || ''}`.toUpperCase() !== preferredModality &&
    `${queueRow.status || ''}`.toUpperCase() === 'WAITING'
  ) {
    await queueRow.update({
      preferred_modality: preferredModality,
    });
  }

  await notifyQueueSockets(specialistId);

  const eta = await getQueuePositionAndEta(queueRow.id, specialistId).catch(() => ({
    position: null,
    estimated_wait_minutes: 0,
  }));

  const plainQueue = queueRow.get({ plain: true });

  return {
    fila: plainQueue,
    eta,
  };
}

async function leaveQueueAuthenticatedUser(authUser, queueId) {
  const qId = `${queueId || ''}`.trim();
  if (
    !/^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.test(qId)
  ) {
    throw new AppError('Identificador de fila inválido.', 400, null, true);
  }

  if (!authUser || authUser.role !== 'CLIENTE') {
    throw new AppError('Apenas clientes podem sair por esta via.', 403, null, true);
  }

  const clientResolved =
    authUser.client_profile ||
    (await Client.findOne({
      where: { user_id: authUser.id },
      paranoid: true,
    }));

  if (!clientResolved?.id) {
    throw new AppError('Cliente não encontrado.', 403, null, true);
  }

  const queueRow = await Queue.findOne({
    where: { id: qId, client_id: clientResolved.id },
    paranoid: true,
  });

  if (!queueRow) {
    throw new AppError('Registro de fila não encontrado.', 404, null, true);
  }

  if (`${queueRow.status || ''}`.toUpperCase() !== 'WAITING') {
    throw new AppError(
      `Não pode sair: situação da fila é ${queueRow.status}.`,
      409,
      null,
      true
    );
  }

  await queueRow.update({
    status: 'CANCELLED_BY_CLIENT',
    left_at: new Date(),
  });

  if (queueRow.specialist_id) {
    await notifyQueueSockets(queueRow.specialist_id);
  }

  return queueRow.get({ plain: true });
}

/**
 * Tarólogas “disponíveis agora”: `ONLINE`, não bloqueadas, sem telecom `PENDING|ACTIVE|WARNING` em `sessions`.
 */
async function distinctSpecialistIdsInBusyTelecom() {
  const [rows] = await sequelize.query(
    `SELECT DISTINCT specialist_id AS sid
       FROM sessions
      WHERE deleted_at IS NULL
        AND specialist_id IS NOT NULL
        AND telecom_status IN (:busy)
    `,
    { replacements: { busy: TELECOM_BUSY_STATUSES } }
  );
  return (rows || []).map((r) => r.sid).filter(Boolean);
}

async function countAvailableOnlineSpecialistsForLeadFsm() {
  const busyIds = await distinctSpecialistIdsInBusyTelecom();
  /** @type {import('sequelize').WhereOptions} */
  const where = {
    status: 'ONLINE',
    is_blocked: false,
  };
  if (busyIds.length) Object.assign(where, { id: { [Op.notIn]: busyIds } });
  return Specialist.count({ where, paranoid: true });
}

/**
 * ETA quando **não há** ninguém livre: usa carga global das filas (`Queue.WAITING`).
 */
async function estimateFleetWaitForLeadFsmWhatsApp() {
  const available = await countAvailableOnlineSpecialistsForLeadFsm();
  if (available > 0) {
    return {
      available_count: available,
      busy: false,
      estimated_wait_minutes: Math.min(12, Math.max(4, Math.ceil(DEFAULT_AVG_SESSION_MINUTES / 2))),
    };
  }
  const totalWaiting = await Queue.count({
    where: { status: 'WAITING' },
    paranoid: true,
  });
  const baseline = DEFAULT_AVG_SESSION_MINUTES;
  const eta = Math.min(120, Math.max(baseline, baseline + Math.ceil(totalWaiting * 1.25)));
  return {
    available_count: 0,
    busy: true,
    estimated_wait_minutes: eta,
    total_waiting_globe: totalWaiting,
  };
}

async function listWaitingForSpecialistPublic(specialistId) {
  const sid = `${specialistId || ''}`.trim();
  if (!/^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.test(sid)) {
    throw new AppError('specialist_id inválido.', 400, null, true);
  }

  const specialist = await Specialist.findByPk(sid, {
    attributes: ['id', 'display_name', 'is_blocked'],
    paranoid: true,
  });
  if (!specialist || specialist.is_blocked) {
    throw new AppError('Especialista não encontrada ou indisponível.', 404, null, true);
  }

  const especialista_publico = specialist.get({ plain: true });
  const fila = await buildPublicWaitingSnapshot(sid);
  const referencia_eta_min_medio_sessions = await averageCompletedTelecomMinutesForSpecialist(sid);

  return {
    especialista_publico,
    referencia_eta_min_medio_sessions,
    fila_espera: fila,
    total_waiting: fila.length,
    timestamp: new Date().toISOString(),
  };
}

module.exports = {
  getQueuePositionAndEta,
  averageCompletedTelecomMinutesForSpecialist,
  buildPublicWaitingSnapshot,
  promoteFirstWaitingAfterSessionEnded,
  joinQueueAuthenticatedUser,
  leaveQueueAuthenticatedUser,
  listWaitingForSpecialistPublic,
  notifyQueueSockets,
  distinctSpecialistIdsInBusyTelecom,
  countAvailableOnlineSpecialistsForLeadFsm,
  estimateFleetWaitForLeadFsmWhatsApp,
};
