const axios = require('axios');
const { RtcTokenBuilder, RtcRole } = require('agora-access-token');

/** @param {'publisher'|'audience'} role */
function rtcRoleConst(role = 'publisher') {
  const r = `${role || ''}`.toLowerCase();
  return r === 'audience' || r === 'subscriber' ? RtcRole.SUBSCRIBER : RtcRole.PUBLISHER;
}

function requireRtcEnvOrThrow() {
  const APP_ID = process.env.AGORA_APP_ID ? String(process.env.AGORA_APP_ID).trim() : '';
  const APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE
    ? String(process.env.AGORA_APP_CERTIFICATE).trim()
    : '';
  if (!APP_ID || !APP_CERTIFICATE) {
    const err = new Error(
      'AGORA_APP_ID e AGORA_APP_CERTIFICATE devem estar definidos para gerar token RTC.'
    );
    err.statusCode = 500;
    err.code = 'AGORA_RTC_CONFIG_MISSING';
    throw err;
  }
  return { APP_ID, APP_CERTIFICATE };
}

/**
 * RTC token (`agora-access-token`).
 * @param {string} channelName
 * @param {number} uid inteiro SDK
 * @param {'publisher'|'audience'} [role='publisher']
 * @param {number} [expirationSecs=3600] TTL em segundos (clamp 60…86400)
 */
function generateRtcToken(channelName, uid, role = 'publisher', expirationSecs = 3600) {
  const { APP_ID, APP_CERTIFICATE } = requireRtcEnvOrThrow();

  const cname = `${channelName || ''}`.trim();
  const uidNum = typeof uid === 'number' ? uid : parseInt(String(uid), 10);
  const ttlRaw = expirationSecs ?? 3600;
  const ttl = Math.min(Math.max(parseInt(String(ttlRaw), 10) || 3600, 60), 24 * 3600);

  if (!cname) {
    const e = new Error('channelName é obrigatório.');
    e.statusCode = 400;
    throw e;
  }
  if (!Number.isFinite(uidNum)) {
    const e = new Error('uid numérico inválido.');
    e.statusCode = 400;
    throw e;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const privilegeExpiredTs = nowSec + ttl;
  const token = RtcTokenBuilder.buildTokenWithUid(
    APP_ID,
    APP_CERTIFICATE,
    cname,
    uidNum,
    rtcRoleConst(role),
    privilegeExpiredTs
  );

  return { token: token, expiresAtUnix: privilegeExpiredTs, uid: uidNum, channelName: cname };
}

function getKickAuthHeaderOrThrow() {
  const cid = process.env.AGORA_CUSTOMER_ID ? String(process.env.AGORA_CUSTOMER_ID).trim() : '';
  const secret = process.env.AGORA_CUSTOMER_SECRET
    ? String(process.env.AGORA_CUSTOMER_SECRET).trim()
    : '';
  if (!cid || !secret) {
    const err = new Error(
      'AGORA_CUSTOMER_ID e AGORA_CUSTOMER_SECRET devem estar definidos para REST Basic Auth da Agora (kick, conversação, etc.).'
    );
    err.statusCode = 500;
    err.code = 'AGORA_REST_CONFIG_MISSING';
    throw err;
  }
  return `Basic ${Buffer.from(`${cid}:${secret}`, 'utf8').toString('base64')}`;
}

/**
 * Conversational AI Engine REST usa `Authorization: agora token=<token>` quando autenticas com RTC token gerado no servidor.
 * Normalmente é o mesmo token que envias em `properties.token` no body do join.
 */
function authorizationAgoraRtcTokenHeader(rtcToken) {
  const t = `${rtcToken || ''}`.trim();
  if (!t) {
    const e = new Error('rtcToken é obrigatório para authorizationAgoraRtcTokenHeader.');
    e.statusCode = 400;
    throw e;
  }
  return `agora token=${t}`;
}

const CONVERSATIONAL_AI_BASE = process.env.AGORA_CONVERSATIONAL_AI_BASE_URL
  ? `${process.env.AGORA_CONVERSATIONAL_AI_BASE_URL}`.trim()
  : 'https://api.agora.io';

/**
 * POST `.../conversational-ai-agent/v2/projects/{appId}/join`
 * authMode `'basic_customer'` (default): Basic com AGORA_CUSTOMER_ID/SECRET. `'rtc_token'`: Authorization `agora token=<rtcToken>`.
 */
async function joinConversationalAiAgent(projectAppId, body, authMode = 'basic_customer', rtcToken) {
  const appId = `${projectAppId || ''}`.trim();
  if (!appId) {
    const e = new Error('projectAppId (App ID da Agora) é obrigatório.');
    e.statusCode = 400;
    throw e;
  }
  const auth =
    authMode === 'rtc_token'
      ? authorizationAgoraRtcTokenHeader(rtcToken)
      : getKickAuthHeaderOrThrow();

  const url = `${CONVERSATIONAL_AI_BASE}/api/conversational-ai-agent/v2/projects/${encodeURIComponent(appId)}/join`;
  const { data } = await axios.post(url, body, {
    headers: {
      Authorization: auth,
      'Content-Type': 'application/json',
    },
    timeout: 60000,
  });
  return data;
}

/**
 * POST …/agents/{agentId}/leave
 */
async function leaveConversationalAiAgent(projectAppId, agentId, authMode = 'basic_customer', rtcToken) {
  const appId = `${projectAppId || ''}`.trim();
  const aid = `${agentId || ''}`.trim();
  if (!appId || !aid) {
    const e = new Error('projectAppId e agentId são obrigatórios.');
    e.statusCode = 400;
    throw e;
  }
  const auth =
    authMode === 'rtc_token'
      ? authorizationAgoraRtcTokenHeader(rtcToken)
      : getKickAuthHeaderOrThrow();

  const url = `${CONVERSATIONAL_AI_BASE}/api/conversational-ai-agent/v2/projects/${encodeURIComponent(appId)}/agents/${encodeURIComponent(aid)}/leave`;
  const { data } = await axios.post(url, {}, {
    headers: {
      Authorization: auth,
      'Content-Type': 'application/json',
    },
    timeout: 30000,
  });

  return data;
}

/**
 * Hard cut imediato (time=0): ver documentação `agora.io-e-intelbras-documentacao.md`.
 * @returns {Promise<Record<string, unknown>>}
 */
async function kickUserFromChannel(channelName, uid) {
  const { APP_ID } = requireRtcEnvOrThrow();

  const cname = `${channelName || ''}`.trim();
  const uidNum = typeof uid === 'bigint' ? Number(uid) : typeof uid === 'number' ? uid : parseInt(String(uid), 10);
  if (!cname || !Number.isFinite(uidNum)) {
    const e = new Error('channelName e uid válidos são obrigatórios para kick.');
    e.statusCode = 400;
    throw e;
  }

  const auth = getKickAuthHeaderOrThrow();

  const response = await axios.post(
    'https://api.sd-rtn.com/dev/v1/kicking-rule',
    {
      appid: APP_ID,
      cname: cname,
      uid: uidNum,
      ip: '',
      time: 0,
      privileges: ['join_channel'],
    },
    {
      headers: {
        Authorization: auth,
        'Content-Type': 'application/json',
      },
      timeout: 25000,
    }
  );

  return response.data;
}

module.exports = {
  rtcRoleConst,
  generateRtcToken,
  getKickAuthHeaderOrThrow,
  authorizationAgoraRtcTokenHeader,
  joinConversationalAiAgent,
  leaveConversationalAiAgent,
  kickUserFromChannel,
};
