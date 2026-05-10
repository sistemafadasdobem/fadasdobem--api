const { Op } = require('sequelize');
const { randomInt, randomUUID } = require('crypto');
const {
  Session,
  Client,
  Specialist,
  LedgerAccount,
  TransactionLedger,
  Review,
  AuditLog,
  PricingLevel,
} = require('../../models');
const { sequelize } = require('../../config/database');
const AppError = require('../../utils/AppError');
const businessRules = require('../../config/business.config');
const { catchAsyncService } = require('../../utils/catchAsync.util');
const agoraClient = require('../../providers/agora/agora.client');
const CHRONO = require('./session.constants');
const telecomManager = require('./telecom.manager');
const queuesService = require('../queues/queues.service');

const SESSION_CREATE_STATUSES = ['SCHEDULED', 'READY'];
const SESSION_MODALITIES_SET = new Set(['TEXTO', 'VOZ', 'VIDEO']);
const AGORA_MAX_UID = 2147483647;

/** Só permite avaliar após ciclo perceptível como “fechado” ou telecom concluída. */
const REVIEW_ELIGIBLE_STATUSES = new Set([
  'ENDED',
  'NO_SHOW_CLIENT',
  'NO_SHOW_SPECIALIST',
  'CANCELLED_BY_CLIENT',
  'CANCELLED_BY_SPECIALIST',
  'CANCELLED_BY_ADMIN',
]);

function sessionAllowsClientReview(sess) {
  if (!sess) return false;
  if (sess.ended_at != null) return true;
  if (`${sess.telecom_status || ''}`.toUpperCase() === 'COMPLETED') return true;
  return REVIEW_ELIGIBLE_STATUSES.has(`${sess.status || ''}`.trim().toUpperCase());
}

/**
 * Quando telecom passa a `COMPLETED`, convida o primeiro `WAITING` e dispara sockets.
 * Só corre se o estado anterior **não** era `COMPLETED` (evita duplicar promoção no mesmo ciclo da sessão).
 */
async function updateSessionTelecomAndMaybeAdvanceQueue(sessionEntity, attrs) {
  const prevTc = `${sessionEntity.telecom_status || ''}`.toUpperCase();
  await sessionEntity.update(attrs);
  const nextTc = `${sessionEntity.telecom_status || ''}`.toUpperCase();
  if (prevTc !== 'COMPLETED' && nextTc === 'COMPLETED' && sessionEntity.specialist_id) {
    finalizeSessionEconomicsAfterTelecomCompletion(sessionEntity.id).catch((e) =>
      console.error('[sessions:economics] falha finalize pós‑COMPLETED:', sessionEntity.id, e?.message || e)
    );
    queuesService
      .promoteFirstWaitingAfterSessionEnded(sessionEntity.specialist_id, {
        session_id: sessionEntity.id,
      })
      .catch((err) =>
        console.error(
          '[Queue] avançar fila pós-COMPLETED falhou:',
          sessionEntity?.id,
          err?.message || err
        )
      );
  }
}

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
    paranoid: true,
    include: [{ model: PricingLevel, as: 'pricing_level', required: true }],
    attributes: ['id', 'pricing_level_id', 'manual_price_override'],
  });
  if (!clientRow || !clientRow.pricing_level) {
    throw new AppError('Cliente sem nível de preço válido (`pricing_level_id`). Configure na Gestão.', 400, null, true);
  }

  const specialist = await Specialist.findByPk(specialistId, {
    paranoid: true,
    attributes: ['id', 'user_id', 'commission_percent_default'],
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

  const pl = clientRow.pricing_level;
  const minutePriceRaw =
    modality === 'VIDEO' ? Number.parseFloat(`${pl.price_video}`) : Number.parseFloat(`${pl.price_text_voice}`);
  if (!Number.isFinite(minutePriceRaw) || minutePriceRaw <= 0) {
    throw new AppError('Preço‑minuto do nível de precificação inválido.', 500, null, false);
  }
  const pctRaw = specialist.commission_percent_default != null
    ? Number.parseFloat(`${specialist.commission_percent_default}`)
    : 70;
  const pctSnapshot = Number.isFinite(pctRaw) && pctRaw >= 0 ? pctRaw : 70;

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
    minute_price_applied_snapshot: roundMoneySes(minutePriceRaw),
    specialist_commission_pct_snapshot: roundMoneySes(pctSnapshot),
    pricing_level_id_snapshot: pl.id ?? clientRow.pricing_level_id ?? null,
    manual_price_override_snapshot: Boolean(clientRow.manual_price_override),
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
    await updateSessionTelecomAndMaybeAdvanceQueue(session, {
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

  if (`${session.telecom_status || ''}`.toUpperCase() === 'COMPLETED') {
    console.log('[Agora:Webhook] User Left ignorado · sessão já COMPLETED', {
      sessionId: session.id,
      channel,
    });
    return;
  }

  const startedMs = session.started_at ? new Date(session.started_at).getTime() : NaN;
  const startedSec = Number.isFinite(startedMs) ? Math.floor(startedMs / 1000) : null;
  const durationCalc = startedSec !== null ? Math.max(0, tsSeconds - startedSec) : null;

  await updateSessionTelecomAndMaybeAdvanceQueue(session, {
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

    await updateSessionTelecomAndMaybeAdvanceQueue(session, {
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

/** @param {number} n */
function roundMoneySes(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.round(x * 10000) / 10000;
}

/** @param {import('sequelize').Transaction} t */
async function ensurePlatformSuspenseLedger(t) {
  let acc = await LedgerAccount.findOne({
    where: {
      account_type: 'PLATFORM_SUSPENSE',
      client_id: { [Op.is]: null },
      specialist_id: { [Op.is]: null },
    },
    transaction: t,
    lock: t.LOCK.UPDATE,
  });
  if (!acc) {
    acc = await LedgerAccount.create(
      {
        account_type: 'PLATFORM_SUSPENSE',
        currency: 'BRL',
        label: 'Suspense — liquidação gateways',
        cached_balance: null,
      },
      { transaction: t }
    );
  }
  return acc;
}

/** @param {string} clientId */
async function ensureClientWalletLedger(clientId, t) {
  let acc = await LedgerAccount.findOne({
    where: { client_id: clientId, account_type: 'CLIENT_WALLET' },
    transaction: t,
    lock: t.LOCK.UPDATE,
  });
  if (!acc) {
    acc = await LedgerAccount.create(
      {
        client_id: clientId,
        account_type: 'CLIENT_WALLET',
        currency: 'BRL',
        label: 'Carteira',
        cached_balance: 0,
      },
      { transaction: t }
    );
  }
  return acc;
}

async function ensurePlatformRevenueLedger(t) {
  let acc = await LedgerAccount.findOne({
    where: {
      account_type: 'PLATFORM_REVENUE',
      client_id: { [Op.is]: null },
      specialist_id: { [Op.is]: null },
    },
    transaction: t,
    lock: t.LOCK.UPDATE,
  });
  if (!acc) {
    acc = await LedgerAccount.create(
      {
        account_type: 'PLATFORM_REVENUE',
        currency: 'BRL',
        label: 'Receita líquida plataforma (margem pós‑consulta)',
        cached_balance: 0,
      },
      { transaction: t }
    );
  }
  return acc;
}

async function ensureSpecialistEarningsLedger(specialistRowId, t) {
  const sp = `${specialistRowId || ''}`.trim();
  if (!sp) throw new AppError('specialist_id ausente no settle económico.', 500, null, false);

  let acc = await LedgerAccount.findOne({
    where: { specialist_id: sp, account_type: 'SPECIALIST_EARNINGS' },
    transaction: t,
    lock: t.LOCK.UPDATE,
  });
  if (!acc) {
    acc = await LedgerAccount.create(
      {
        specialist_id: sp,
        account_type: 'SPECIALIST_EARNINGS',
        currency: 'BRL',
        label: `Ganhos tarólogo ${sp.slice(0, 8)}…`,
        cached_balance: 0,
      },
      { transaction: t }
    );
  }
  return acc;
}

function cachedNum(acc) {
  const n = Number(acc?.cached_balance);
  return Number.isFinite(n) ? n : 0;
}

/** Fecho financeiro idempotente quando `telecom_status` passa a COMPLETED. Carteira tarólogo = SPECIALIST_EARNINGS. */
async function finalizeSessionEconomicsAfterTelecomCompletion(sessionId) {
  const sid = `${sessionId || ''}`.trim();
  if (!sid) return;

  await sequelize.transaction(async (t) => {
    const session = await Session.findByPk(sid, { paranoid: true, transaction: t, lock: t.LOCK.UPDATE });
    if (!session) return;
    if (`${session.telecom_status || ''}`.toUpperCase() !== 'COMPLETED') return;
    if (session.economics_settled_at) return;

    const paidM = Math.max(0, Math.floor(Number(session.paid_minutes_used ?? 0)));
    const minutePrice = Number.parseFloat(`${session.minute_price_applied_snapshot ?? ''}`);
    let totalGoal = Number.parseFloat(`${session.total_cost ?? ''}`);

    if ((!Number.isFinite(totalGoal) || totalGoal <= 0) && paidM > 0 && Number.isFinite(minutePrice) && minutePrice > 0) {
      totalGoal = roundMoneySes(paidM * minutePrice) ?? 0;
    }
    totalGoal =
      Number.isFinite(totalGoal) && totalGoal > 0 ? (roundMoneySes(totalGoal) ?? totalGoal) : 0;

    if (!(totalGoal > 0)) {
      await session.update(
        {
          total_cost: 0,
          specialist_commission_amount_snapshot: 0,
          platform_fee_amount_snapshot: 0,
          economics_settled_at: new Date(),
        },
        { transaction: t }
      );
      return;
    }

    const wallet = await ensureClientWalletLedger(session.client_id, t);
    await wallet.reload({ transaction: t, lock: t.LOCK.UPDATE });
    const suspense = await ensurePlatformSuspenseLedger(t);
    await suspense.reload({ transaction: t, lock: t.LOCK.UPDATE });

    const wBal = cachedNum(wallet);
    const absorb = Math.min(totalGoal, Math.max(0, roundMoneySes(wBal) ?? wBal));

    if (!(absorb > 0)) {
      console.warn('[sessions:economics] carteira cliente sem liquidez suficiente', { session_id: sid, goal: totalGoal });
      await session.update(
        {
          total_cost: totalGoal,
          specialist_commission_amount_snapshot: 0,
          platform_fee_amount_snapshot: 0,
          economics_settled_at: new Date(),
        },
        { transaction: t }
      );
      return;
    }

    const idConsume = `sess-revenue-to-suspense-${sid}`;
    const consumedLedger = await TransactionLedger.findOne({ where: { idempotency_key: idConsume }, transaction: t });

    if (!consumedLedger) {
      await TransactionLedger.create(
        {
          debit_account_id: wallet.id,
          credit_account_id: suspense.id,
          amount: absorb,
          reference_type: 'SESSION_CONSUMPTION',
          reference_id: session.id,
          idempotency_key: idConsume,
          description: `Consumo sessão (${paidM} min pagos efectivos; absorb ${absorb} BRL)`,
          metadata: {
            absorb_brl: absorb,
            paid_minutes_floor: paidM,
          },
          occurred_at: session.ended_at || new Date(),
        },
        { transaction: t }
      );
      await wallet.update({ cached_balance: roundMoneySes(wBal - absorb) }, { transaction: t });

      await suspense.reload({ transaction: t, lock: t.LOCK.UPDATE });
      const sBalBefore = cachedNum(suspense);
      await suspense.update({ cached_balance: roundMoneySes(sBalBefore + absorb) }, { transaction: t });
    }

    let pctRaw = Number.parseFloat(`${session.specialist_commission_pct_snapshot ?? ''}`);
    if (!Number.isFinite(pctRaw) || pctRaw < 0) {
      const specLookup = await Specialist.findByPk(session.specialist_id, {
        paranoid: true,
        attributes: ['commission_percent_default'],
        transaction: t,
      });
      const fb = Number.parseFloat(`${specLookup?.commission_percent_default ?? '70'}`);
      pctRaw = Number.isFinite(fb) && fb >= 0 ? fb : 70;
    }

    let specialistAmt = roundMoneySes((absorb * pctRaw) / 100) ?? 0;
    if (!(specialistAmt >= 0) || specialistAmt > absorb) specialistAmt = 0;
    let platformAmt = roundMoneySes(absorb - specialistAmt);
    platformAmt =
      typeof platformAmt === 'number' && Number.isFinite(platformAmt) ? Math.max(0, platformAmt) : 0;

    const specialistEarn = await ensureSpecialistEarningsLedger(session.specialist_id, t);
    const platRev = await ensurePlatformRevenueLedger(t);

    const idSpec = `commission-specialist-split-${sid}`;
    const existsSpec = await TransactionLedger.findOne({ where: { idempotency_key: idSpec }, transaction: t });

    if (!existsSpec && specialistAmt > 0) {
      await suspense.reload({ transaction: t, lock: t.LOCK.UPDATE });
      const sMid = cachedNum(suspense);
      if (sMid + 1e-9 >= specialistAmt) {
        await TransactionLedger.create(
          {
            debit_account_id: suspense.id,
            credit_account_id: specialistEarn.id,
            amount: specialistAmt,
            reference_type: 'COMMISSION_SPLIT',
            reference_id: session.id,
            idempotency_key: idSpec,
            description: `Comissão tarólogo · pct ${pctRaw}% sobre ${absorb}`,
            metadata: { leg: 'specialist', absorb_brl: absorb, pct: pctRaw },
            occurred_at: new Date(),
          },
          { transaction: t }
        );
        await specialistEarn.reload({ transaction: t, lock: t.LOCK.UPDATE });
        await specialistEarn.update(
          {
            cached_balance: roundMoneySes(cachedNum(specialistEarn) + specialistAmt),
          },
          { transaction: t }
        );
        await suspense.reload({ transaction: t, lock: t.LOCK.UPDATE });
        await suspense.update({ cached_balance: roundMoneySes(cachedNum(suspense) - specialistAmt) }, { transaction: t });
      }
    }

    const idPlat = `commission-platform-split-${sid}`;
    const existsPlat = await TransactionLedger.findOne({ where: { idempotency_key: idPlat }, transaction: t });

    if (!existsPlat && platformAmt > 0) {
      await suspense.reload({ transaction: t, lock: t.LOCK.UPDATE });
      const s2 = cachedNum(suspense);
      const payout = Math.min(platformAmt, Math.max(0, s2));
      if (payout > 0) {
        await TransactionLedger.create(
          {
            debit_account_id: suspense.id,
            credit_account_id: platRev.id,
            amount: payout,
            reference_type: 'COMMISSION_SPLIT',
            reference_id: session.id,
            idempotency_key: idPlat,
            description: `Margem líquida plataforma sobre consulta (${absorb})`,
            metadata: { leg: 'platform_margin', absorb_brl: absorb, specialist_brl: specialistAmt },
            occurred_at: new Date(),
          },
          { transaction: t }
        );
        await platRev.reload({ transaction: t, lock: t.LOCK.UPDATE });
        await platRev.update(
          {
            cached_balance: roundMoneySes(cachedNum(platRev) + payout),
          },
          { transaction: t }
        );
        await suspense.reload({ transaction: t, lock: t.LOCK.UPDATE });
        await suspense.update({ cached_balance: roundMoneySes(cachedNum(suspense) - payout) }, { transaction: t });
      }
    }

    await session.update(
      {
        total_cost: absorb,
        specialist_commission_pct_snapshot: pctRaw,
        specialist_commission_amount_snapshot: specialistAmt,
        platform_fee_amount_snapshot: platformAmt,
        economics_settled_at: new Date(),
      },
      { transaction: t }
    );
  });
}

/**
 * Motor “piso mínimo” (~15 min económicos): créditos `FLOOR_COMPENSATION` proporcionais a
 * `MAX(0, floorMinutes − paid_minutes_used_snapshot)` quando a sessão termina elegível (`business.config`).
 *
 * Debita `PLATFORM_SUSPENSE` → `CLIENT_WALLET`. Idempotência compartilha o legado `system-floor-session-*`.
 *
 * @param {string} sessionId
 */
async function applyMinimumFloorReimbursement(sessionId) {
  const sid = `${sessionId || ''}`.trim();
  const sessionRow = sid ? await Session.findByPk(sid, { paranoid: true }) : null;

  if (!sessionRow) {
    throw new AppError('Sessão não encontrada.', 404, null, true);
  }

  if (!sessionRow.ended_reason_code || !`${sessionRow.ended_reason_code || ''}`.trim()) {
    throw new AppError(
      'Sessão sem `ended_reason_code` definido — defina antes o motivo antes de aplicar o piso mínimo.',
      409,
      null,
      true
    );
  }

  const endedReasonRaw = `${sessionRow.ended_reason_code || ''}`.trim().toUpperCase();
  const eligibleCodes = businessRules.SESSION_FLOOR_ELIGIBLE_END_REASONS;
  const eligible = new Set(eligibleCodes);
  if (!eligible.has(endedReasonRaw)) {
    throw new AppError(
      `Ajuste de piso só aplica quando ended_reason_code é um dos valores permitidos (${eligibleCodes.join(
        ', '
      )}).`,
      400,
      { ended_reason_code: endedReasonRaw || null },
      true
    );
  }

  const priceMin = Number.parseFloat(`${sessionRow.minute_price_applied_snapshot ?? ''}`);
  if (!Number.isFinite(priceMin) || priceMin <= 0) {
    throw new AppError(
      'minute_price_applied_snapshot em falta ou inválido para esta sessão — não há base para o piso.',
      400,
      null,
      true
    );
  }

  const consumedRaw = Number(sessionRow.paid_minutes_used ?? 0);
  const paidMinutesConsumed =
    Number.isFinite(consumedRaw) && consumedRaw >= 0 ? Math.floor(consumedRaw) : 0;

  const floorMinutes = businessRules.SESSION_MINIMUM_FLOOR_MINUTES;
  const bonusMinutes = Math.max(0, floorMinutes - paidMinutesConsumed);
  const targetCreditEquivalent = roundMoneySes(bonusMinutes * priceMin);

  const idempotencyKey = `floor-compensation-session-${sid}`;
  const legacyIdempotencyKey = `system-floor-session-${sid}`;

  const existing = await TransactionLedger.findOne({
    where: { idempotency_key: { [Op.in]: [idempotencyKey, legacyIdempotencyKey] } },
  });
  if (existing) {
    const bonusPaid = Number(existing.amount);
    return {
      applied: false,
      idempotent_hit: true,
      bonus_added: bonusPaid,
      bonus_minutes: bonusMinutes,
      paid_minutes_consumed: paidMinutesConsumed,
      session_id: sid,
      message: 'Compensação de piso já foi aplicada (idempotência).',
    };
  }

  let bonusAdded = 0;

  /** Sem crédito efetivo: não há movimento económico novo. */
  if (!(targetCreditEquivalent > 0)) {
    return {
      applied: false,
      bonus_added: 0,
      bonus_minutes: bonusMinutes,
      paid_minutes_consumed: paidMinutesConsumed,
      target_credit_equivalent_brl: targetCreditEquivalent,
      floor_minutes_budget: floorMinutes,
      session_id: sid,
      message: `Minutos‑bónus = max(0, ${floorMinutes} − ${paidMinutesConsumed}) ⇒ sem crédito.`,
    };
  }

  await sequelize.transaction(async (t) => {
    await Session.findByPk(sid, { transaction: t, lock: t.LOCK.UPDATE, paranoid: true });

    const wallet = await ensureClientWalletLedger(sessionRow.client_id, t);

    await wallet.reload({ transaction: t, lock: t.LOCK.UPDATE });

    const bal = Number(wallet.cached_balance ?? 0);
    const roundedBonus = roundMoneySes(targetCreditEquivalent);
    bonusAdded = roundedBonus ?? 0;

    if (!roundedBonus || roundedBonus <= 0) {
      return;
    }

    const suspense = await ensurePlatformSuspenseLedger(t);

    await TransactionLedger.create(
      {
        debit_account_id: suspense.id,
        credit_account_id: wallet.id,
        amount: roundedBonus,
        reference_type: 'FLOOR_COMPENSATION',
        reference_id: sessionRow.id,
        idempotency_key: idempotencyKey,
        description: `Piso (${floorMinutes} min): bónus de minutos após uso parcial (${paidMinutesConsumed} min consumidos · sessão ${sessionRow.id})`,
        metadata: {
          minute_price_applied_snapshot: priceMin,
          floor_minutes_budget: floorMinutes,
          ended_reason_code: endedReasonRaw,
          paid_minutes_consumed_snapshot: paidMinutesConsumed,
          bonus_minutes_calc: bonusMinutes,
          formula: `MAX(0, ${floorMinutes} - ${paidMinutesConsumed})`,
          previous_cached_balance_client: bal,
        },
        occurred_at: new Date(),
      },
      { transaction: t }
    );

    const newBal = roundMoneySes(bal + roundedBonus);
    await wallet.update(
      {
        cached_balance: newBal,
      },
      { transaction: t }
    );
  });

  return {
    applied: bonusAdded > 0,
    bonus_added: bonusAdded,
    bonus_minutes: bonusMinutes,
    paid_minutes_consumed: paidMinutesConsumed,
    target_credit_equivalent_brl: targetCreditEquivalent,
    floor_minutes_budget: floorMinutes,
    session_id: sid,
  };
}

/**
 * POST sessão/avaliação — **apenas** a cliente titular (`users.role === CLIENTE` + `client_profile`).
 *
 * @param {import('../../models/User')} user
 * @param {Record<string, unknown>} [body]
 * @param {{ ip?: string; userAgent?: string; correlationId?: string }} [httpCtx]
 */
async function submitSessionReview(user, sessionId, body = {}, httpCtx = {}) {
  if (`${user?.role || ''}`.trim().toUpperCase() !== 'CLIENTE') {
    throw new AppError('Apenas clientes registadas podem submeter avaliações.', 403, null, true);
  }

  const clientProf = user.client_profile;
  if (!clientProf?.id) {
    throw new AppError('Perfil cliente incompleto — não é possível avaliar.', 403, null, true);
  }

  const sid = `${sessionId || ''}`.trim();
  if (!sid) {
    throw new AppError('Identificador de sessão em falta.', 400, null, true);
  }

  const ratingRaw =
    typeof body?.rating === 'number' ? body.rating : parseInt(`${body?.rating ?? ''}`, 10);
  if (!Number.isInteger(ratingRaw) || ratingRaw < 1 || ratingRaw > 5) {
    throw new AppError('Informe uma nota `rating` inteira entre 1 e 5.', 400, null, true);
  }

  const commentRaw =
    typeof body?.comment === 'string' ? body.comment.trim() : `${body?.comment ?? ''}`.trim();
  const comment = commentRaw.slice(0, 4000) || null;

  const is_public =
    body?.is_public !== undefined ? Boolean(body.is_public === true || body.is_public === 'true') : true;

  const existingReview = await Review.findOne({
    where: { session_id: sid },
    paranoid: true,
    attributes: ['id'],
  });
  if (existingReview) {
    throw new AppError('Esta sessão já possui avaliação.', 409, null, true);
  }

  const session = await Session.findByPk(sid, {
    paranoid: true,
    attributes: ['id', 'client_id', 'specialist_id', 'status', 'ended_at', 'telecom_status'],
  });

  if (!session) {
    throw new AppError('Sessão não encontrada.', 404, null, true);
  }

  if (`${session.client_id}` !== `${clientProf.id}`) {
    throw new AppError('Só a cliente titular desta sessão pode avaliar.', 403, null, true);
  }

  if (!sessionAllowsClientReview(session)) {
    throw new AppError(
      'A sessão ainda não está elegível para avaliação — aguarde o encerramento da consulta.',
      409,
      null,
      true
    );
  }

  let reviewRow;
  await sequelize.transaction(async (t) => {
    const dupAgain = await Review.findOne({
      where: { session_id: sid },
      transaction: t,
      lock: t.LOCK.UPDATE,
      paranoid: true,
      attributes: ['id'],
    });
    if (dupAgain) {
      throw new AppError('Esta sessão já possui avaliação.', 409, null, true);
    }

    reviewRow = await Review.create(
      {
        session_id: sid,
        client_id: clientProf.id,
        specialist_id: session.specialist_id,
        rating: ratingRaw,
        comment,
        is_public,
      },
      { transaction: t }
    );

    await AuditLog.create(
      {
        admin_id: null,
        action: 'SESSION_CLIENT_REVIEW_SUBMIT',
        target_entity: 'Review',
        target_id: reviewRow.id,
        old_value: null,
        new_value: {
          session_id: sid,
          specialist_id: session.specialist_id,
          rating: ratingRaw,
          is_public,
          comment_preview: comment ? `${comment.slice(0, 240)}${comment.length > 240 ? '…' : ''}` : null,
        },
        metadata: {
          client_user_id: user.id,
          client_id: clientProf.id,
        },
        ip_address: `${httpCtx.ip || ''}`.trim().slice(0, 45) || null,
        user_agent:
          `${httpCtx.userAgent || ''}`.trim().slice(0, 2000) || null,
        correlation_id: `${httpCtx.correlationId || ''}`.trim().slice(0, 64) || null,
        occurred_at: new Date(),
      },
      { transaction: t }
    );
  });

  return {
    review_id: reviewRow.id,
    session_id: sid,
    specialist_id: session.specialist_id,
    rating: reviewRow.rating,
    comment: reviewRow.comment,
    is_public: reviewRow.is_public,
  };
}

const RITUAL_MSG_MAX = 1500;

/**
 * PATCH ritual — apenas a tarólogo atribuída; sessão já encerrada à luz telecom / lifecycle.
 *
 * @param {import('../../models/User')} user
 * @param {Record<string, unknown>} body
 */
async function patchPostSessionRitual(user, sessionId, body = {}, httpCtx = {}) {
  const sid = `${sessionId || ''}`.trim();
  if (!sid) throw new AppError('Identificador de sessão em falta.', 400, null, true);

  const specialist = await Specialist.findOne({
    where: { user_id: user.id },
    paranoid: true,
    attributes: ['id'],
  });
  if (!specialist?.id) {
    throw new AppError('Perfil tarólogo não encontrado.', 403, null, true);
  }

  const raw =
    body?.post_session_message != null
      ? `${body.post_session_message}`
      : body?.postSessionMessage != null
        ? `${body.postSessionMessage}`
        : '';
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new AppError('Informe `post_session_message`.', 400, null, true);
  }
  if (trimmed.length > RITUAL_MSG_MAX) {
    throw new AppError(`Máximo ${RITUAL_MSG_MAX} caracteres na mensagem ritualística.`, 400, null, true);
  }

  const session = await Session.findByPk(sid, {
    paranoid: true,
    attributes: ['id', 'specialist_id', 'status', 'ended_at', 'telecom_status', 'post_session_message'],
  });
  if (!session) throw new AppError('Sessão não encontrada.', 404, null, true);
  if (`${session.specialist_id}` !== `${specialist.id}`) {
    throw new AppError('Só a tarólogo desta sessão pode enviar a mensagem ritualística.', 403, null, true);
  }

  if (!sessionAllowsClientReview(session)) {
    throw new AppError(
      'A sessão ainda não está encerrada ao nível telecom / lifecycle — mensagem não disponível.',
      409,
      null,
      true
    );
  }

  const prevMsg = session.post_session_message ? `${session.post_session_message}` : null;

  await sequelize.transaction(async (t) => {
    await session.reload({
      paranoid: true,
      transaction: t,
      lock: t.LOCK.UPDATE,
      attributes: ['id', 'specialist_id', 'telecom_status', 'ended_at', 'status'],
    });

    if (`${session.specialist_id}` !== `${specialist.id}`) {
      throw new AppError('Só a tarólogo desta sessão pode enviar a mensagem ritualística.', 403, null, true);
    }
    if (!sessionAllowsClientReview(session)) {
      throw new AppError(
        'A sessão já não está elegível neste momento.',
        409,
        null,
        true
      );
    }

    await Session.update(
      { post_session_message: trimmed },
      { where: { id: sid }, transaction: t }
    );

    await AuditLog.create(
      {
        admin_id: null,
        action: 'SESSION_POST_RITUAL_MESSAGE',
        target_entity: 'Session',
        target_id: sid,
        old_value: prevMsg
          ? { post_session_message_preview: `${prevMsg.slice(0, 120)}${prevMsg.length > 120 ? '…' : ''}` }
          : null,
        new_value: {
          post_session_message_preview: `${trimmed.slice(0, 120)}${trimmed.length > 120 ? '…' : ''}`,
        },
        metadata: { specialist_user_id: user.id, specialist_id: specialist.id },
        ip_address: `${httpCtx.ip || ''}`.trim().slice(0, 45) || null,
        user_agent: `${httpCtx.userAgent || ''}`.trim().slice(0, 2000) || null,
        correlation_id: `${httpCtx.correlationId || ''}`.trim().slice(0, 64) || null,
        occurred_at: new Date(),
      },
      { transaction: t }
    );
  });

  const fresh = await Session.findByPk(sid, {
    paranoid: true,
    attributes: ['id', 'post_session_message', 'specialist_id', 'telecom_status', 'status', 'ended_at'],
  });

  return {
    session_id: sid,
    post_session_message: fresh?.post_session_message ?? trimmed,
    specialist_id: specialist.id,
    telecom_status: fresh?.telecom_status,
    session_status: fresh?.status,
  };
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
  applyMinimumFloorReimbursement,
  submitSessionReview,
  patchPostSessionRitual,
};
