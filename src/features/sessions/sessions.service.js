const { Op } = require('sequelize');
const { Session, Client, Specialist, LedgerAccount } = require('../../models');
const AppError = require('../../utils/AppError');
const { catchAsyncService } = require('../../utils/catchAsync.util');
const agoraClient = require('../../providers/agora/agora.client');
const CHRONO = require('./session.constants');
const telecomManager = require('./telecom.manager');

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

  const roleWant = `${opts.role || ''}`.toLowerCase();
  const rtcRole =
    roleWant === 'subscriber' || roleWant === 'audience' ? 'audience' : 'publisher';

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
    /** `publisher` = taróloga (host); `audience`/`subscriber` = cliente */
    role: rtcRole,
    roleUsed: rtcRole,
    telecom_status: session.telecom_status,
    telecomStatus: session.telecom_status,
  };
}

async function processAgoraNcsWebhookAsync(body) {
  const rawType = body?.eventType ?? body?.event_type;
  const eventType =
    typeof rawType === 'number'
      ? rawType
      : typeof rawType === 'string'
        ? parseInt(rawType, 10)
        : NaN;

  if (!Number.isFinite(eventType)) return;

  const payload =
    typeof body?.payload === 'object' && body.payload !== null && !Array.isArray(body.payload)
      ? body.payload
      : {};

  const channel = typeof payload.channelName === 'string' ? payload.channelName.trim() : '';
  if (!channel || (eventType !== 103 && eventType !== 104)) {
    return;
  }

  const uidJoin = parseUidFlexible(payload.uid);
  if (uidJoin === null) {
    console.warn('[agora:webhook] uid inválido', { channel, eventType });
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
    console.warn('[agora:webhook] sessão não encontrada para canal', channel);
    return;
  }

  const tsSeconds = resolveWebhookTimestampSeconds(payload, body || {});

  if (!uidMatchesSession(session, uidJoin)) {
    console.warn('[agora:webhook] uid ignorado nesta sessão', channel, uidJoin);
    return;
  }

  if (eventType === 103) {
    await session.update({
      telecom_status: 'ACTIVE',
      started_at: session.started_at || new Date(tsSeconds * 1000),
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
}

module.exports = {
  clampExpires,
  getRtcTokenForAuthenticatedUser,
  processAgoraNcsWebhookAsync,
  billingTickSweepAsync,
  /** versão não empacotada do sweep (workers / testes) */
  runBillingTickSweep,
};
