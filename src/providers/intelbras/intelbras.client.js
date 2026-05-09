/**
 * Intelbras Wide Voice — API REST (HTTPS + JSON).
 * Ajuste caminhos e campos em `INTELBRAS_REST_PATH_*` se o suporte confirmar diferenças na collection.
 */
'use strict';

const axios = require('axios');
const AppError = require('../../utils/AppError');

/** Caminhos POST relativos a `INTELBRAS_REST_URL` — fáceis de alinhar ao Postman oficial. */
const INTELBRAS_REST_PATH_CHAMAR = '/chamar';
const INTELBRAS_REST_PATH_DESLIGAR = '/desligar';

const DEFAULT_TIMEOUT_MS = Math.min(
  120000,
  Math.max(3000, parseInt(String(process.env.INTELBRAS_REST_TIMEOUT_MS || '15000'), 10) || 15000)
);

let http = null;

function getBaseUrl() {
  return `${process.env.INTELBRAS_REST_URL || ''}`.trim().replace(/\/+$/, '');
}

function getLoginToken() {
  return {
    login: `${process.env.INTELBRAS_REST_LOGIN || ''}`.trim(),
    token: `${process.env.INTELBRAS_REST_TOKEN || ''}`.trim(),
  };
}

function ensureClient() {
  const baseURL = getBaseUrl();
  const { login, token } = getLoginToken();
  if (!baseURL || !login || !token) {
    throw new AppError(
      'Integração Intelbras Wide Voice indisponível: defina INTELBRAS_REST_URL, INTELBRAS_REST_LOGIN e INTELBRAS_REST_TOKEN.',
      503,
      null,
      true
    );
  }
  if (!http || http.defaults?.baseURL !== baseURL) {
    http = axios.create({
      baseURL,
      headers: { 'Content-Type': 'application/json' },
      timeout: DEFAULT_TIMEOUT_MS,
      validateStatus: () => true,
    });

    http.interceptors.request.use((config) => {
      const payload =
        config.data && typeof config.data === 'object' && !Array.isArray(config.data)
          ? { ...config.data }
          : {};
      const { login: lg, token: tk } = getLoginToken();
      /** `login` e `token` finais — credenciais obrigatórias em todo POST. */
      config.data = {
        ...payload,
        login: lg,
        token: tk,
      };
      return config;
    });

    http.interceptors.response.use(
      (res) => res,
      (error) => {
        console.error('[Intelbras:REST] request falhou', {
          url: error.config?.url,
          message: error.message,
          status: error.response?.status,
          data: error.response?.data,
        });
        return Promise.reject(error);
      }
    );
  }
  return http;
}

function interpretWideVoiceData(data) {
  if (!data || typeof data !== 'object') return { ok: false, message: 'Resposta inválida.' };
  const status = String(data.Status ?? data.status ?? '').trim();
  const ok = status.toUpperCase() === 'OK';
  const message =
    data.Mensagem != null
      ? String(data.Mensagem)
      : data.message != null
        ? String(data.message)
        : !ok
          ? status || 'Erro desconhecido.'
          : '';
  return { ok, message, status };
}

/**
 * Click-to-call (dois estágios no PABX).
 *
 * @param {string} ramalOrigem   Ramal / origem (ex.: taróloga)
 * @param {string} numeroDestino Destino (DDD+número, só dígitos ou com +)
 * @returns {Promise<string>} `UniqueId` retornado pela API
 */
async function originateCall(ramalOrigem, numeroDestino) {
  const ramal = `${ramalOrigem || ''}`.trim();
  const destino = `${numeroDestino || ''}`.replace(/[^\d+]/g, '');
  if (!ramal || !destino) {
    throw new AppError('ramalOrigem e numeroDestino são obrigatórios.', 400, null, true);
  }

  try {
    const client = ensureClient();
    const { data, status } = await client.post(INTELBRAS_REST_PATH_CHAMAR, {
      acao: 'originar',
      ramal,
      destino,
    });

    const inter = interpretWideVoiceData(data);
    if (status >= 400 || !inter.ok) {
      throw new AppError(
        inter.message || 'Falha ao originar chamada Intelbras Wide Voice.',
        status >= 400 && status < 600 ? status : 502,
        data,
        true
      );
    }

    const uniqueId = data?.UniqueId ?? data?.CallId ?? data?.uniqueId ?? data?.uniqueid;
    if (!uniqueId) {
      throw new AppError(
        'Resposta Intelbras sem UniqueId — confirme o contrato da API com o suporte.',
        502,
        data,
        true
      );
    }
    console.log('[Intelbras:REST] originar OK', { uniqueId: String(uniqueId) });
    return String(uniqueId);
  } catch (err) {
    if (err instanceof AppError) throw err;
    const data = err.response?.data;
    if (data && typeof data === 'object') {
      const inter = interpretWideVoiceData(data);
      throw new AppError(inter.message || 'Erro na API Intelbras Wide Voice.', err.response?.status || 502, data, true);
    }
    throw new AppError(err.message || 'Falha de rede ou timeout na API Intelbras.', 503, null, true);
  }
}

/**
 * Hard cut — encerra a chamada pelo identificador da API.
 *
 * @param {string} uniqueId
 * @returns {Promise<{ ok: boolean; raw?: object }>}
 */
async function hangupCall(uniqueId) {
  const uid = `${uniqueId || ''}`.trim();
  if (!uid) {
    throw new AppError('uniqueId é obrigatório para desligar chamada.', 400, null, true);
  }

  try {
    const client = ensureClient();
    const { data, status } = await client.post(INTELBRAS_REST_PATH_DESLIGAR, {
      acao: 'desligar',
      uniqueid: uid,
    });

    const inter = interpretWideVoiceData(data);
    if (status >= 400 || !inter.ok) {
      throw new AppError(
        inter.message || 'Falha ao desligar chamada Intelbras.',
        status >= 400 && status < 600 ? status : 502,
        data,
        true
      );
    }
    console.log('[Intelbras:REST] desligar OK', { uniqueId: uid.slice(0, 64) });
    return { ok: true, raw: data };
  } catch (err) {
    if (err instanceof AppError) throw err;
    const data = err.response?.data;
    if (data && typeof data === 'object') {
      const inter = interpretWideVoiceData(data);
      throw new AppError(inter.message || 'Erro na API Intelbras ao desligar.', err.response?.status || 502, data, true);
    }
    throw new AppError(err.message || 'Falha de rede ou timeout na API Intelbras.', 503, null, true);
  }
}

module.exports = {
  INTELBRAS_REST_PATH_CHAMAR,
  INTELBRAS_REST_PATH_DESLIGAR,
  originateCall,
  hangupCall,
};
