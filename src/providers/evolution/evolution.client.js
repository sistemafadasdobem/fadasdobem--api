const axios = require('axios');

function sanitizeBase(raw) {
  return (raw || '').replace(/\/+$/, '');
}

/** Cliente Axios pré-configurado com `apikey` global Evolution. */
function buildHttp() {
  const baseURL = sanitizeBase(process.env.EVOLUTION_API_BASE_URL || '');
  const apikey = process.env.EVOLUTION_GLOBAL_API_KEY || '';
  return axios.create({
    baseURL,
    headers: {
      ...(apikey ? { apikey } : {}),
    },
    timeout: 30_000,
  });
}

async function rawRequest(method, path, data = undefined, extraHeaders = {}) {
  const http = buildHttp();
  return http.request({
    url: path.replace(/^\//, ''),
    method,
    data,
    headers: { ...extraHeaders },
  });
}

/** Lista instâncias visíveis à API-key (útil ao painel admin). */
async function fetchInstances() {
  const { data } = await rawRequest('get', '/instance/fetchInstances');
  return data;
}

async function instanceCreate(payload) {
  const { data } = await rawRequest('post', '/instance/create', payload);
  return data;
}

async function restartInstance(instanceName) {
  const { data } = await rawRequest(
    'put',
    `/instance/restart/${encodeURIComponent(instanceName)}`
  );
  return data;
}

async function qrCodeReconnect(instanceName) {
  const { data } = await rawRequest(
    'get',
    `/instance/connect/${encodeURIComponent(instanceName)}`
  );
  return data;
}

function encodeInstance(inst) {
  return encodeURIComponent(`${inst || ''}`.trim());
}

/** DDI + DDD + número, só dígitos (sem pré-fixo `@`). Evolution v2. */
function normalizeWhatsappNumber(number) {
  return `${number ?? ''}`.replace(/\D/g, '');
}

/**
 * POST `/message/sendText/{instance}`
 * @param {string} instanceName
 * @param {{ number: string, text: string }} body
 */
async function sendMessageText(instanceName, body) {
  const inst = encodeInstance(instanceName);
  const payload = {
    number: normalizeWhatsappNumber(body.number),
    text: `${body.text ?? ''}`,
  };
  const { data } = await rawRequest('post', `/message/sendText/${inst}`, payload);
  return data;
}

/**
 * POST `/message/sendButtons/{instance}` — até 3 botões interactivos típicos.
 * @see https://doc.evolution-api.com/v2/api-reference/message-controller/send-button
 */
async function sendButtons(instanceName, body) {
  const inst = encodeInstance(instanceName);
  const { data } = await rawRequest('post', `/message/sendButtons/${inst}`, body);
  return data;
}

/**
 * POST `/message/sendList/{instance}`
 * @see https://doc.evolution-api.com/v2/api-reference/message-controller/send-list
 */
async function sendList(instanceName, body) {
  const inst = encodeInstance(instanceName);
  const { data } = await rawRequest('post', `/message/sendList/${inst}`, body);
  return data;
}

/**
 * POST `/message/sendMedia/{instance}` — URL ou data URL/base64 conforme Evolution.
 */
async function sendMessageMedia(instanceName, body) {
  const inst = encodeInstance(instanceName);
  const payload = {
    ...body,
    number: normalizeWhatsappNumber(body.number),
  };
  const { data } = await rawRequest('post', `/message/sendMedia/${inst}`, payload);
  return data;
}

module.exports = {
  buildHttp,
  rawRequest,
  fetchInstances,
  instanceCreate,
  restartInstance,
  qrCodeReconnect,
  normalizeWhatsappNumber,
  sendMessageText,
  sendButtons,
  sendList,
  sendMessageMedia,
};
