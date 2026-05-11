'use strict';

/**
 * Intelbras WideVoice — integração alinhada ao manual API `api.php` (POST JSON com `acao`, `login`, `token`).
 *
 * Variáveis:
 * - INTELBRAS_WIDEVOICE_BASE_URL (ex.: https://fadasdobem.intelbrasvoice.com.br)
 * - INTELBRAS_WIDEVOICE_API_PATH (default /api.php)
 * - INTELBRAS_WIDEVOICE_LOGIN / INTELBRAS_WIDEVOICE_TOKEN
 * Compat: INTELBRAS_REST_LOGIN / INTELBRAS_REST_TOKEN / INTELBRAS_REST_URL (última como base URL legada)
 */

const axios = require('axios');
const AppError = require('../../utils/AppError');
const { Specialist } = require('../../models');
const dialPlan = require('../../utils/widevoiceDialPlan.util');

const DEFAULT_TIMEOUT_MS = Math.min(
  120000,
  Math.max(3000, parseInt(String(process.env.INTELBRAS_REST_TIMEOUT_MS || '15000'), 10) || 15000)
);

/** Logs em consola (`clicktocall` / labouratório): `false` silencia payloads no terminal PRD */
function intelbrasWideVoiceConsoleLogEnabled() {
  const v = `${process.env.INTELBRAS_LAB_CONSOLE_LOG || 'true'}`.trim().toLowerCase();
  return v !== 'false' && v !== '0' && v !== 'off';
}

/** @type {import('axios').AxiosInstance|null} */
let http = null;

function getBaseOrigin() {
  const explicit = `${process.env.INTELBRAS_WIDEVOICE_BASE_URL || ''}`.trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const legacy = `${process.env.INTELBRAS_REST_URL || ''}`.trim().replace(/\/+$/, '');
  /** URL antiga podia incluir `/api` ou `/api.php` — usar apenas host para WideVoice v2. */
  if (legacy.includes('intelbrasvoice.com.br')) {
    return legacy.replace(/\/api(?:\.php)?$/i, '').replace(/\/+$/, '');
  }
  return legacy.replace(/\/api(?:\.php)?$/i, '').replace(/\/+$/, '');
}

function getApiPath() {
  const raw = `${process.env.INTELBRAS_WIDEVOICE_API_PATH || ''}`.trim();
  if (raw) return raw.startsWith('/') ? raw : `/${raw}`;
  /** Postman “oficial” WideVoice (referência). */
  return '/api.php';
}

function getCredentials() {
  const login =
    `${process.env.INTELBRAS_WIDEVOICE_LOGIN || process.env.INTELBRAS_REST_LOGIN || ''}`.trim();
  const token =
    `${process.env.INTELBRAS_WIDEVOICE_TOKEN || process.env.INTELBRAS_REST_TOKEN || ''}`.trim();
  return { login, token };
}

function ensureConfigured() {
  const origin = getBaseOrigin();
  const { login, token } = getCredentials();
  if (!origin || !login || !token) {
    throw new AppError(
      'WideVoice indisponível: defina INTELBRAS_WIDEVOICE_BASE_URL (ou INTELBRAS_REST_URL para compat), INTELBRAS_WIDEVOICE_LOGIN e INTELBRAS_WIDEVOICE_TOKEN (ou INTELBRAS_REST_LOGIN / TOKEN).',
      503,
      null,
      true
    );
  }
  return { origin, login, token };
}

function ensureHttp() {
  const { origin } = ensureConfigured();
  const apiPath = getApiPath();
  const originNorm = origin.replace(/\/+$/, '');
  const currentBase = `${http?.defaults?.baseURL || ''}`.replace(/\/+$/, '');

  if (!http || currentBase !== originNorm) {
    http = axios.create({
      baseURL: origin,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      timeout: DEFAULT_TIMEOUT_MS,
      validateStatus: () => true,
    });
  }
  return { client: http, apiPath };
}

function tupleArrayToPairs(data) {
  const out = {};
  if (!Array.isArray(data)) return out;
  for (let i = 0; i < data.length - 1; i += 2) {
    const k = `${data[i]}`.trim();
    let v = data[i + 1];
    if (typeof v === 'string') v = v.trim();
    out[k] = v;
    out[`${k}`.toLowerCase()] = v;
    out[`${k}`.toUpperCase()] = v;
  }
  return out;
}

function flattenWideVoiceResponse(data) {
  if (Array.isArray(data)) {
    return tupleArrayToPairs(data);
  }
  if (data && typeof data === 'object') {
    return data;
  }
  return {};
}

function isTupleSuccess(map) {
  const stRaw = `${map.Status ?? map.status ?? ''}`.trim().toUpperCase();
  if (!stRaw) return false;
  if (/ERRO|FALHA|NEGAD|INVÁLIDO|INVALIDO/i.test(stRaw)) return false;
  return (
    stRaw === 'CHAMADA OK' ||
    stRaw.includes('SUCESS') ||
    stRaw === 'OK' ||
    stRaw.startsWith('OK')
  );
}

/**
 * @param {string} acao
 * @param {Record<string, unknown>} [extra]
 */
async function wideVoiceAction(acao, extra = {}) {
  const { login, token } = ensureConfigured();
  const { client, apiPath } = ensureHttp();

  const body = {
    acao,
    login,
    token,
    ...extra,
  };

  const { data, status } = await client.post(apiPath, body);
  const flat = flattenWideVoiceResponse(data);

  return { status, raw: data, flat };
}

/**
 * Click-to-call (vídeo/voz nativo central).
 * @param {{ origem: string, destino: string, formatDestino?: boolean }} p
 * @returns {Promise<string>} ID devolvido pela central (quando presente).
 */
async function clickToCall(p) {
  const origem = `${p?.origem ?? ''}`.trim();
  let destino = `${p?.destino ?? ''}`.trim();
  if (!origem || !destino) {
    throw new AppError('clicktocall: `origem` e `destino` são obrigatórios.', 400, null, true);
  }

  if (p?.formatDestino !== false) {
    destino = dialPlan.formatBrazilDestinationForWideVoice(destino);
  }

  const { status, raw, flat } = await wideVoiceAction('clicktocall', { origem, destino });

  if (status < 200 || status >= 300 || !isTupleSuccess(flat)) {
    const msg =
      `${flat.Mensagem || flat.mensagem || flat.Status || flat.status || 'Erro WideVoice'}`.trim() ||
      'Falha clicktocall WideVoice.';
    throw new AppError(msg, status >= 400 && status < 600 ? status : 502, { raw }, true);
  }

  const id =
    flat.ID ||
    flat.id ||
    flat.UniqueId ||
    flat.uniqueid ||
    flat.callid ||
    flat.CallId ||
    null;
  if (!id) {
    console.warn('[WideVoice] clicktocall sem ID explícito — guardar payload bruto para reconciliação.', {
      rawPreview: JSON.stringify(raw).slice(0, 400),
    });
  }
  return id ? String(id) : '';
}

/**
 * Igual a `clickToCall`, mas devolve payload completo para laboratório / observabilidade (sem alterar fluxo produtivo).
 */
async function clickToCallDetailed(p) {
  const origem = `${p?.origem ?? ''}`.trim();
  let destino = `${p?.destino ?? ''}`.trim();
  if (!origem || !destino) {
    throw new AppError('clicktocall: `origem` e `destino` são obrigatórios.', 400, null, true);
  }

  if (p?.formatDestino !== false) {
    destino = dialPlan.formatBrazilDestinationForWideVoice(destino);
  }

  const { origin } = ensureConfigured();
  const apiPath = getApiPath();
  if (intelbrasWideVoiceConsoleLogEnabled()) {
    console.log('[WideVoice:clicktocall] pedido → POST', `${origin}${apiPath}`, {
      acao: 'clicktocall',
      origem,
      /** Número exatamente como enviado no JSON `destino` (DDD local vs `011`). */
      destino,
    });
  }

  const { status, raw, flat } = await wideVoiceAction('clicktocall', { origem, destino });

  const bizOk = status >= 200 && status < 300 && isTupleSuccess(flat);
  const id =
    flat.ID ||
    flat.id ||
    flat.UniqueId ||
    flat.uniqueid ||
    flat.callid ||
    flat.CallId ||
    null;

  if (intelbrasWideVoiceConsoleLogEnabled()) {
    const peek = Array.isArray(raw)
      ? raw.slice(0, 14)
      : typeof raw === 'object' && raw
        ? raw
        : String(raw).slice(0, 280);
    console.log('[WideVoice:clicktocall] resposta', {
      http_status: status,
      success_negocio: bizOk,
      status_tuple: flat.Status ?? flat.status ?? null,
      call_id: id ? String(id) : null,
      mensagem_flat: flat.Mensagem || flat.mensagem || null,
      raw_compacto: peek,
    });
    if (bizOk) {
      console.log(
        '[WideVoice:clicktocall] A central aceitou o comando. Se o telefone **não tocou**: (1) rota/roaming do destino · (2) `origem` precisa estar livre/register na PBX · (3) formato `destino` que a Intelbras espera pode diferir do nosso normalize — pergunte ao suporte · (4) IP egresso da VPS deve estar liberado.'
      );
    } else {
      console.warn('[WideVoice:clicktocall] falha negócio ou HTTP', { http_status: status });
    }
  }

  return {
    success: bizOk,
    http_status: status,
    destino_enviado: destino,
    call_id: id ? String(id) : '',
    widevoice_raw: raw,
    widevoice_flat: flat,
  };
}

/**
 * Liberta ramal preso / força desligamento operacional (conforme manual — recomendado no hard cut).
 */
async function liberarRamal(ramal) {
  const r = `${ramal || ''}`.trim();
  if (!r) {
    throw new AppError('liberarramal: ramal ausente.', 400, null, true);
  }
  const field =
    `${process.env.INTELBRAS_WIDEVOICE_LIBERAR_RAMAL_FIELD || 'ramal'}`.trim() || 'ramal';
  const payload = { [field]: r };

  const { status, raw, flat } = await wideVoiceAction('liberarramal', payload);
  if (status < 200 || status >= 300) {
    throw new AppError(
      `liberarramal HTTP ${status}`,
      status >= 400 && status < 600 ? status : 502,
      { raw },
      true
    );
  }
  const st = `${flat.Status ?? flat.status ?? ''}`.trim().toUpperCase();
  if (st && st !== 'OK' && !st.includes('OK')) {
    console.warn('[WideVoice] liberarramal resposta ambígua', { st, raw });
  }
  return { ok: true, raw, flat };
}

/**
 * Consulta estados de ramais (polling curto — worker dedicado pode consumir).
 */
async function statusRamais(extra = {}) {
  return wideVoiceAction('statusramais', extra);
}

/**
 * Relatório de chamadas (até 500 linhas por doc).
 */
async function statusReport(extra = {}) {
  return wideVoiceAction('statusreport', extra);
}

/**
 * Tentativa legada opcional: desligar por uniqueid (se a instância ainda expuser).
 */
async function desligarPorUniqueId(uniqueId) {
  const uid = `${uniqueId || ''}`.trim();
  if (!uid) return { skipped: true };
  const { status, raw, flat } = await wideVoiceAction('desligar', { uniqueid: uid, uniqueId: uid });
  const ok = status >= 200 && status < 300 && isTupleSuccess(flat);
  return { ok, raw, flat, status };
}

/**
 * **Hard cut / fim de saldo:** tenta encerrar mídia na ordem — `desligar` (se existir) + `liberarramal`.
 * @param {{ intelbras_unique_id?: string|null, specialist_id?: string|null }} sessionRow
 * @param {{ intelbras_ramal?: string|null }} [specialistHint]
 */
async function hangupSessionMedia(sessionRow, specialistHint = {}) {
  const uid = `${sessionRow?.intelbras_unique_id ?? ''}`.trim();
  let ramal = `${specialistHint?.intelbras_ramal ?? ''}`.trim();

  if (!ramal && sessionRow?.specialist_id) {
    const sp = await Specialist.findByPk(sessionRow.specialist_id, {
      attributes: ['intelbras_ramal'],
      paranoid: true,
    });
    ramal = `${sp?.intelbras_ramal ?? ''}`.trim();
  }

  /** @type {string[]} */
  const steps = [];

  /** 1) Libertação imediata do ramal (central) — requisito CTO no hard cut por saldo 0. */
  if (ramal) {
    try {
      await liberarRamal(ramal);
      steps.push('liberarramal:ok');
    } catch (e) {
      steps.push(`liberarramal:err:${String(e?.message || e).slice(0, 160)}`);
      throw e;
    }
  }

  /** 2) Opcional: instâncias que ainda expuserem desligar por uniqueid. */
  if (uid && `${process.env.INTELBRAS_WIDEVOICE_TRY_DESLIGAR_BY_UID || ''}`.trim() === 'true') {
    try {
      const r = await desligarPorUniqueId(uid);
      steps.push(`desligar_uid:${r.ok ? 'ok' : 'fail'}`);
    } catch (e) {
      steps.push(`desligar_uid:err:${String(e?.message || e).slice(0, 120)}`);
    }
  }

  if (!ramal && !uid) {
    console.warn('[WideVoice] hangupSessionMedia — sem uniqueId e sem ramal; impossível forçar corte SIP.', {
      sessionId: sessionRow?.id,
    });
    return { ok: false, steps: [...steps, 'no-op'] };
  }

  return { ok: true, steps };
}

module.exports = {
  getBaseOrigin,
  getApiPath,
  wideVoiceAction,
  clickToCall,
  clickToCallDetailed,
  liberarRamal,
  statusRamais,
  statusReport,
  hangupSessionMedia,
  formatBrazilDestinationForWideVoice: dialPlan.formatBrazilDestinationForWideVoice,
  desligarPorUniqueId,
};
