const { Op } = require('sequelize');
const { randomInt, randomUUID } = require('crypto');
const { Session, Client, Specialist, LedgerAccount } = require('../../models');
const AppError = require('../../utils/AppError');
const { catchAsyncService } = require('../../utils/catchAsync.util');
const agoraClient = require('../../providers/agora/agora.client');
const CHRONO = require('./session.constants');
const telecomManager = require('./telecom.manager');

const SESSION_CREATE_STATUSES = ['SCHEDULED', 'READY'];
const SESSION_MODALITIES_SET = new Set(['TEXTO', 'VOZ', 'VIDEO']);
const AGORA_MAX_UID = 2147483647;

/**
 * Dois UIDs Agora inteiros distintos (intervalo [1, 2^31-1]).
 * @returns {{ clientUid: number, specialistUid: number }}
 */
function pickDistinctAgoraUids() {
  let a;
  let b;
  do {
    a = randomInt(1, AGORA_MAX_UID);
    b = randomInt(1, AGORA_MAX_UID);
  } while (a === b);
  return { clientUid: a, specialistUid: b };
}

/**
 * POST /sessions — cliente autenticado abre sessão (ex.: VIDEO + Agora).
 * `client_id` na BD é o UUID de `clients`, resolvido pelo `User` autenticado (não confundir com `users.id`).
 */
async function createSession(authenticatedUser, body = {}) {
  const specialistId = `${body.specialist_id ?? body.specialistId ?? ''}`.trim();
  const modality = `${body.modality ?? ''}`.trim().toUpperCase();
  const statusRaw = `${body.status ?? ''}`.trim().toUpperCase();
  const lifecycleStatus =
    statusRaw && SESSION_CREATE_STATUSES.includes(statusRaw) ? statusRaw : 'READY';

  if (!specialistId) {
    throw new AppError('specialist_id é obrigatório.', 400, null, true);
  }
  if (!SESSION_MODALITIES_SET.has(modality)) {
    throw new AppError('modality inválida. Use TEXTO, VOZ ou VIDEO.', 400, null, true);
  }

  const clientRow = await Client.findOne({
    where: { user_id: authenticatedUser.id },
    attributes: ['id'],
    paranoid: true,
  });
  if (!clientRow) {
    throw new AppError('Perfil de cliente não encontrado para este usuário.', 403, null, true);
  }

  const specialist = await Specialist.findByPk(specialistId, {
    paranoid: true,
    attributes: ['id', 'user_id'],
  });
  if (!specialist) {
    throw new AppError('Especialista não encontrada.', 404, null, true);
  }
  if (specialist.user_id === authenticatedUser.id) {
    throw new AppError('Não é possível agendar sessão consigo mesma como especialista.', 400, null, true);
  }

  const channelName = randomUUID();
  const isVideo = modality === 'VIDEO';
  const isVoice = modality === 'VOZ';
  const { clientUid, specialistUid } = isVideo ? pickDistinctAgoraUids() : { clientUid: null, specialistUid: null };

  const session = await Session.create({
    client_id: clientRow.id,
    specialist_id: specialistId,
    modality,
    status: lifecycleStatus,
    telecom_provider: isVideo ? 'AGORA' : isVoice ? 'INTELBRAS' : null,
    provider_channel_id: channelName,
    agora_channel_id: isVideo ? channelName : null,
    agora_uid_client: isVideo ? clientUid : null,
    agora_uid_specialist: isVideo ? specialistUid : null,
    telecom_status: 'PENDING',
  });

  console.log('[Sessions] criada', {
    id: session.id,
    provider_channel_id: channelName,
    modality,
    telecom_provider: isVideo ? 'AGORA' : isVoice ? 'INTELBRAS' : null,
  });

  return session.get({ plain: true });
}

/** Resumo seguro para logs (sem expor token ou payloads enormes). */
function summarizeNcsBodyForLog(body) {
  const { envelope, payload } = normalizeNcsEnvelopeAndPayload(body);
  const channel = extractNcsChannelName(payload, envelope);
  return {
    eventType: envelope.eventType ?? envelope.event_type ?? null,
    channelName: channel || null,
    uid: extractNcsUidRaw(payload, envelope),
    reason: payload.reason != null ? String(payload.reason).slice(0, 120) : null,
    notifyMs: typeof envelope.notifyMs === 'number' ? envelope.notifyMs : null,
    noticeId: typeof envelope.noticeId === 'string' ? envelope.noticeId.slice(0, 64) : null,
    payloadKeys: payload && typeof payload === 'object' ? Object.keys(payload).slice(0, 16) : [],
    topKeys: envelope && typeof envelope === 'object' ? Object.keys(envelope).slice(0, 16) : [],
  };
}

/**
 * Corpo NCS pode trazer `payload` como objeto, string JSON, ou campos repetidos fora do payload.
 */
function normalizeNcsEnvelopeAndPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { envelope: {}, payload: {} };
  }
  let payload = body.payload;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      payload = {};
    }
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    payload = {};
  }
  return { envelope: body, payload };
}

function parseNcsEventType(envelope) {
  const raw = envelope?.eventType ?? envelope?.event_type;
  let et =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string'
        ? parseInt(raw, 10)
        : NaN;
  if (Number.isFinite(et)) return et;
  const nid = envelope?.noticeId;
  if (typeof nid === 'string' && nid.includes(':')) {
    const last = nid.split(':').pop();
    const p = parseInt(String(last), 10);
    if (Number.isFinite(p)) return p;
  }
  return NaN;
}

/** Canal RTC: NCS usa `channelName`; variantes comuns em integrações. */
function extractNcsChannelName(payload, envelope) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const e = envelope && typeof envelope === 'object' ? envelope : {};
  const c =
    (typeof p.channelName === 'string' && p.channelName.trim()) ||
    (typeof p.channel === 'string' && p.channel.trim()) ||
    (typeof p.cname === 'string' && p.cname.trim()) ||
    (typeof e.channelName === 'string' && e.channelName.trim()) ||
    (typeof e.channel === 'string' && e.channel.trim()) ||
    '';
  return c;
}

function extractNcsUidRaw(payload, envelope) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const e = envelope && typeof envelope === 'object' ? envelope : {};
  return p.uid ?? p.userId ?? p.account ?? e.uid ?? null;
}

/** UID após coerção numérica (RTC Agora é inteiro). */
function extractNcsUidNumeric(payload, envelope) {
  return parseUidFlexible(extractNcsUidRaw(payload, envelope));
}

function maskTokenPreview(token) {
  const t = `${token || ''}`;
  if (t.length <= 12) return '(curto)';
  return `${t.slice(0, 8)}…${t.slice(-6)} (${t.length}b)`;
}

function clampExpires(seconds) {
  const n =
    typeof seconds === 'string'
      ? parseInt(seconds, 10)
      : typeof seconds === 'number'
        ? seconds
        : 3600;
  if (!Number.isFinite(n)) return 3600;
  return Math.min(Math.max(Math.trunc(n), 60), 24 * 3600);
}

function parseUidFlexible(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'bigint') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null;
  }
  const n = parseInt(String(raw).trim(), 10);
  return Number.isFinite(n) ? n : null;
}

function uidMatchesSession(session, numericUid) {
  if (numericUid === null) return false;
  const cu = parseUidFlexible(session.agora_uid_client);
  const su = parseUidFlexible(session.agora_uid_specialist);
  return numericUid === cu || numericUid === su;
}

function resolveWebhookTimestampSeconds(payload, envelope = {}) {
  const tsRaw = payload?.ts;
  if (typeof tsRaw === 'number' && tsRaw >= 946684800 && tsRaw < 4102444800) return tsRaw;
  const nm =
    typeof envelope?.notifyMs === 'number'
      ? envelope.notifyMs
      : typeof payload?.notifyMs === 'number'
        ? payload.notifyMs
        : null;
  if (nm !== null && Number.isFinite(nm)) return Math.floor(nm / 1000);
  return Math.floor(Date.now() / 1000);
}

/**
 * Tick do cronômetro 2+X+2 (esboço):
 * − minutos corridos inteiros após `started_at`;
 * − primeiros FREE_INITIAL gratuitos (`paid_minutes_used` só aumenta depois da cortesia);
 * − compara carteira cliente (`CLIENT_WALLET.cached_balance`) ao preço‑minuto snapshot;
 * − HARD CUT quando os minutos pagos extrapolam o comprável;
 * − `WARNING` quando restam até `WARNING_REMAINING_MINUTES` minutos inteiro‑arredondados de saldo pago estimado.
 */
async function runBillingTickSweep() {
  const sessions = await Session.findAll({
    where: {
      telecom_status: { [Op.in]: ['ACTIVE', 'WARNING'] },
      started_at: { [Op.ne]: null },
      ended_at: null,
      telecom_provider: { [Op.in]: ['AGORA', 'INTELBRAS', 'WHATSAPP'] },
    },
    paranoid: true,
    limit: 200,
    order: [['updated_at', 'ASC']],
  });

  for (const session of sessions) {
    await processOneBillingSession(session).catch((err) => {
      console.error('[billing:tick]', session.id, err?.message || err);
    });
  }
}

async function processOneBillingSession(session) {
  const introFree = Number(CHRONO.FREE_INITIAL_MINUTES) || 0;
  const warnRemain = Number(CHRONO.WARNING_REMAINING_MINUTES) || 0;

  const startedMs = session.started_at ? new Date(session.started_at).getTime() : NaN;
  if (!Number.isFinite(startedMs)) return;

  const elapsedMinutesFloor = Math.max(0, Math.floor((Date.now() - startedMs) / 60000));

  const freeUsed = Math.min(introFree, elapsedMinutesFloor);
  const paidUsed = Math.max(0, elapsedMinutesFloor - introFree);

  const mp = Number.parseFloat(`${session.minute_price_applied_snapshot ?? ''}`);
  if (!Number.isFinite(mp) || mp <= 0) {
    await session.update({
      free_minutes_used: freeUsed,
      paid_minutes_used: paidUsed,
    });
    return;
  }

  const wallet = await LedgerAccount.findOne({
    where: { client_id: session.client_id, account_type: 'CLIENT_WALLET' },
    attributes: ['id', 'cached_balance'],
  });
  const bal = Number.parseFloat(`${wallet?.cached_balance ?? ''}`);
  if (!Number.isFinite(bal)) {
    await session.update({
      free_minutes_used: freeUsed,
      paid_minutes_used: paidUsed,
    });
    return;
  }

  const affordablePaidWholeMinutes = Math.max(0, Math.floor(bal / mp));

  /** Minutos‑saldo já “queimados” depois da cortesia. */
  const remainingPaidBucket = affordablePaidWholeMinutes - paidUsed;

  if (paidUsed > 0 && remainingPaidBucket <= 0) {
    console.warn('[Agora:Billing] saldo esgotado · hard cut', {
      sessionId: session.id,
      paidUsed,
      freeUsed,
      channel: `${session.provider_channel_id || session.agora_channel_id || ''}`.trim() || null,
    });
    await telecomManager.disconnectSession(session).catch(() => {});
    await session.update({
      telecom_status: 'COMPLETED',
      ended_at: session.ended_at || new Date(),
      ended_reason_code: 'NO_BALANCE_HARD_CUT',
      free_minutes_used: freeUsed,
      paid_minutes_used: paidUsed,
      billing_closed_at: session.billing_closed_at || new Date(),
    });
    return;
  }

  if (
    paidUsed > 0 &&
    remainingPaidBucket > 0 &&
    remainingPaidBucket <= warnRemain &&
    session.telecom_status !== 'WARNING'
  ) {
    console.log('[Agora:Billing] WARNING — minutos pagos restantes baixos', {
      sessionId: session.id,
      remainingPaidBucket,
      paidUsed,
    });
    await session.update({
      telecom_status: 'WARNING',
      free_minutes_used: freeUsed,
      paid_minutes_used: paidUsed,
    });
    return;
  }

  await session.update({
    free_minutes_used: freeUsed,
    paid_minutes_used: paidUsed,
  });
}

const billingTickSweepAsync = catchAsyncService(runBillingTickSweep);

/** @param {{ role?: string, expiresInSeconds?: number|string }} opts */
async function getRtcTokenForAuthenticatedUser(sessionId, authenticatedUserId, opts = {}) {
  const sid = `${sessionId || ''}`.trim();
  const session = sid ? await Session.findByPk(sid, { paranoid: true }) : null;

  if (!session) {
    throw new AppError('Sessão não encontrada.', 404, null, true);
  }

  if (`${session.telecom_provider || ''}`.trim().toUpperCase() !== 'AGORA') {
    throw new AppError('Esta sessão não está configurada para Agora RTC.', 400, null, true);
  }

  const [clientProf, specialistProf] = await Promise.all([
    Client.findOne({
      where: { id: session.client_id },
      attributes: ['id', 'user_id'],
      paranoid: true,
    }),
    Specialist.findOne({
      where: { id: session.specialist_id },
      attributes: ['id', 'user_id'],
      paranoid: true,
    }),
  ]);

  if (!clientProf?.user_id || !specialistProf?.user_id) {
    throw new AppError('Não foi possível resolver usuários ligados à sessão.', 500, null, true);
  }

  const uidRequester = authenticatedUserId;
  if (clientProf.user_id !== uidRequester && specialistProf.user_id !== uidRequester) {
    throw new AppError('Acesso não autorizado a esta sessão.', 403, null, true);
  }

  const channelRaw =
    `${session.provider_channel_id || ''}`.trim() || `${session.agora_channel_id || ''}`.trim();
  if (!channelRaw) {
    throw new AppError(
      'Canal não definido (provider_channel_id ou agora_channel_id legado).',
      400,
      null,
      true
    );
  }

  const rawUidStored =
    clientProf.user_id === uidRequester ? session.agora_uid_client : session.agora_uid_specialist;
  const rtcUidNum = parseUidFlexible(rawUidStored);
  if (rtcUidNum === null) {
    throw new AppError(
      'UID Agora não atribuído para o seu papel (agora_uid_*).',
      400,
      null,
      true
    );
  }

  /**
   * Consulta 1-a-1: cliente e especialista precisam de áudio (e normalmente vídeo).
   * O token RTC usa sempre `RtcRole.PUBLISHER` para ambos; `role` na query é legado e ignorado.
   */
  const roleWant = `${opts.role || ''}`.toLowerCase();
  if (roleWant === 'audience' || roleWant === 'subscriber') {
    console.log(
      '[Agora:RTC] aviso: query `role=audience|subscriber` ignorada — consulta 1-a-1 usa sempre publisher.'
    );
  }
  const rtcRole = 'publisher';

  const expiresSecs = clampExpires(opts.expiresInSeconds);

  let pack;
  try {
    pack = agoraClient.generateRtcToken(channelRaw, rtcUidNum, rtcRole, expiresSecs);
  } catch (e) {
    const code =
      typeof e.statusCode === 'number' ? e.statusCode : e.code === 'AGORA_RTC_CONFIG_MISSING' ? 503 : 502;
    throw new AppError(
      typeof e.message === 'string' && e.message.trim() ? e.message : 'Falha ao gerar token Agora.',
      code >= 400 && code < 600 ? code : 502,
      null,
      true
    );
  }

  const appId = `${process.env.AGORA_APP_ID || ''}`.trim();
  console.log('[Agora:RTC] token emitido', {
    sessionId: sid,
    channel: channelRaw,
    rtcRole,
    uid: rtcUidNum,
    expiresSecs,
    appIdPreview: appId ? `${appId.slice(0, 8)}…` : null,
    tokenPreview: maskTokenPreview(pack.token),
  });
  return {
    token: pack.token,
    /** Canal Agora (`cname`) — preferível no front Renan */
    channel_name: pack.channelName,
    channelName: pack.channelName,
    uid: pack.uid,
    app_id: appId,
    appId,
    expires_at_unix: pack.expiresAtUnix,
    expiresAtUnix: pack.expiresAtUnix,
    /** Sempre `publisher` (1-a-1) — mesmo UID do cliente ou da taróloga conforme quem pede o token */
    role: rtcRole,
    roleUsed: rtcRole,
    telecom_status: session.telecom_status,
    telecomStatus: session.telecom_status,
  };
}

async function processAgoraNcsWebhookAsync(body) {
  const summary = summarizeNcsBodyForLog(body);
  console.log('[Agora:Webhook] processando async', summary);

  const { envelope, payload } = normalizeNcsEnvelopeAndPayload(body);
  const eventType = parseNcsEventType(envelope);

  if (!Number.isFinite(eventType)) {
    console.log('[Agora:Webhook] ignorado · eventType inválido ou ausente', summary);
    return;
  }

  const channel = extractNcsChannelName(payload, envelope);
  if (!channel || (eventType !== 103 && eventType !== 104)) {
    console.log('[Agora:Webhook] ignorado · fora 103/104 ou sem channel', {
      eventType,
      channel: channel || null,
      productId: envelope?.productId ?? null,
    });
    return;
  }

  const uidJoin = extractNcsUidNumeric(payload, envelope);
  if (uidJoin === null) {
    console.warn('[Agora:Webhook] uid inválido no payload', { channel, eventType, summary });
    return;
  }

  let session =
    (await Session.findOne({
      where: { provider_channel_id: channel },
      paranoid: true,
      order: [['updated_at', 'DESC']],
    })) ||
    (await Session.findOne({
      where: { agora_channel_id: channel },
      paranoid: true,
      order: [['updated_at', 'DESC']],
    }));

  if (!session) {
    console.warn('[Agora:Webhook] nenhuma Session na BD para o canal', { channel, eventType, uidJoin });
    return;
  }

  const tsSeconds = resolveWebhookTimestampSeconds(payload, envelope || {});

  if (!uidMatchesSession(session, uidJoin)) {
    console.warn('[Agora:Webhook] uid não corresponde agora_uid_client/specialist', {
      sessionId: session.id,
      channel,
      eventType,
      uidJoin,
    });
    return;
  }

  if (eventType === 103) {
    const wasStarted = Boolean(session.started_at);
    await session.update({
      telecom_status: 'ACTIVE',
      started_at: session.started_at || new Date(tsSeconds * 1000),
    });
    console.log('[Agora:Webhook] User Joined (103) → ACTIVE', {
      sessionId: session.id,
      channel,
      uidJoin,
      tsSeconds,
      started_at_preexistente: wasStarted,
    });
    return;
  }

  const startedMs = session.started_at ? new Date(session.started_at).getTime() : NaN;
  const startedSec = Number.isFinite(startedMs) ? Math.floor(startedMs / 1000) : null;
  const durationCalc = startedSec !== null ? Math.max(0, tsSeconds - startedSec) : null;

  await session.update({
    telecom_status: 'COMPLETED',
    ended_at: new Date(tsSeconds * 1000),
    rtc_duration_seconds: typeof durationCalc === 'number' ? Math.trunc(durationCalc) : null,
    rtc_end_reason:
      payload.reason !== undefined && payload.reason !== null ? String(payload.reason) : null,
  });

  console.log('[Agora:Webhook] User Left (104) → COMPLETED', {
    sessionId: session.id,
    channel,
    uidJoin,
    tsSeconds,
    rtc_duration_seconds: typeof durationCalc === 'number' ? Math.trunc(durationCalc) : null,
    rtc_end_reason:
      payload.reason !== undefined && payload.reason !== null ? String(payload.reason).slice(0, 120) : null,
  });
}

function normIntelbrasStr(v) {
  return `${v ?? ''}`.trim();
}

function parseIntelbrasWebhookDate(raw) {
  const s = normIntelbrasStr(raw);
  if (!s) return null;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
}

function parseDuracaoSeconds(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, Math.trunc(raw));
  const n = parseInt(String(raw).trim(), 10);
  return Number.isFinite(n) ? Math.max(0, n) : null;
}

function mapIntelbrasCausaToEndedReason(causa) {
  const c = `${causa ?? ''}`.trim().toUpperCase();
  if (!c) return 'UNKNOWN';
  if (c.includes('NORMAL')) return 'NORMAL_COMPLETION';
  if (c.includes('USER') || c.includes('BUSY') || c.includes('NO ANSWER') || c.includes('CANCEL'))
    return 'CLIENT_DISCONNECT';
  return 'UNKNOWN';
}

/**
 * @param {Record<string, unknown>} event
 */
async function findSessionForIntelbrasWebhook(event) {
  const ids = [
    normIntelbrasStr(event.UniqueId ?? event.uniqueId),
    normIntelbrasStr(event.UniqueId2 ?? event.uniqueId2),
  ].filter(Boolean);
  for (const uid of ids) {
    const row = await Session.findOne({
      where: {
        telecom_provider: 'INTELBRAS',
        [Op.or]: [{ intelbras_unique_id: uid }, { intelbras_call_id: uid }],
      },
      paranoid: true,
      order: [['updated_at', 'DESC']],
    });
    if (row) return row;
  }
  return null;
}

/**
 * Webhook Intelbras Wide Voice — configurar URL pública no painel da central.
 * Processar de forma assíncrona após HTTP 200 imediato (igual NCS Agora).
 *
 * @param {Record<string, unknown>} event
 */
async function processIntelbrasTelephonyWebhookAsync(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return;

  const tipo = normIntelbrasStr(event.Evento ?? event.evento).toUpperCase();
  const st = normIntelbrasStr(event.Status ?? event.status).toUpperCase();

  const isAnswered =
    tipo === 'BRIDGE' || tipo === 'ANSWERED' || st === 'ANSWERED';

  const isHangup = tipo === 'HANGUP' || st === 'HANGUP';

  if (!isAnswered && !isHangup) {
    console.log('[Intelbras:Webhook] evento ignorado', { tipo: tipo || null, status: st || null });
    return;
  }

  const session = await findSessionForIntelbrasWebhook(event);
  if (!session) {
    console.warn('[Intelbras:Webhook] sessão não encontrada para UniqueId(s)', {
      UniqueId: event.UniqueId ?? null,
      UniqueId2: event.UniqueId2 ?? null,
    });
    return;
  }

  if (isAnswered) {
    if (`${session.telecom_status || ''}`.toUpperCase() === 'COMPLETED') return;

    const atend =
      parseIntelbrasWebhookDate(event.DataHoraAtendimento ?? event.DataHora) ||
      (session.started_at ? new Date(session.started_at) : null) ||
      new Date();

    const uidPrimary = normIntelbrasStr(event.UniqueId ?? event.uniqueId);

    await session.update({
      telecom_status: 'ACTIVE',
      started_at: session.started_at || atend,
      intelbras_unique_id: uidPrimary || session.intelbras_unique_id,
    });

    console.log('[Intelbras:Webhook] atendimento → ACTIVE', {
      sessionId: session.id,
      uniqueId: uidPrimary || null,
    });
    return;
  }

  if (isHangup) {
    if (session.ended_at) return;

    const endedAt = parseIntelbrasWebhookDate(event.DataHoraFim) || new Date();
    let durationSec = parseDuracaoSeconds(
      event.Duracao != null ? event.Duracao : event.duracao
    );
    const startedMs = session.started_at ? new Date(session.started_at).getTime() : NaN;
    if (durationSec === null && Number.isFinite(startedMs)) {
      durationSec = Math.max(0, Math.floor((endedAt.getTime() - startedMs) / 1000));
    }

    await session.update({
      telecom_status: 'COMPLETED',
      ended_at: endedAt,
      rtc_duration_seconds: durationSec,
      rtc_end_reason: event.Causa != null ? String(event.Causa) : null,
      ended_reason_code: mapIntelbrasCausaToEndedReason(event.Causa),
    });

    console.log('[Intelbras:Webhook] Hangup → COMPLETED', {
      sessionId: session.id,
      rtc_duration_seconds: durationSec,
    });
  }
}

module.exports = {
  clampExpires,
  summarizeNcsBodyForLog,
  createSession,
  getRtcTokenForAuthenticatedUser,
  processAgoraNcsWebhookAsync,
  billingTickSweepAsync,
  /** versão não empacotada do sweep (workers / testes) */
  runBillingTickSweep,
  processIntelbrasTelephonyWebhookAsync,
};
