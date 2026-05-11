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
    const tupleFlat = tupleArrayToPairs(data);
    if (Object.keys(tupleFlat).length > 0) {
      return tupleFlat;
    }
    const row0 = data[0];
    if (
      data.length > 0 &&
      typeof row0 === 'object' &&
      row0 !== null &&
      !Array.isArray(row0)
    ) {
      const out = { _array_registos: data.length };
      if (row0.Ramal != null) out._snapshot_primeiro_ramal = `${row0.Ramal}`;
      if (row0.ramal != null && out._snapshot_primeiro_ramal == null) {
        out._snapshot_primeiro_ramal = `${row0.ramal}`;
      }
      if (row0.tipo != null) out._snapshot_primeiro_tipo = `${row0.tipo}`;
      if (row0.Status != null) out._snapshot_primeiro_status = `${row0.Status}`;
      return out;
    }
    return {};
  }
  if (typeof data === 'string') {
    return { texto_literal: data };
  }
  if (data !== null && data !== undefined && typeof data === 'object') {
    return data;
  }
  return {};
}

/**
 * A central às vezes devolve BOM, HTML de gateway ou corpo vazio; o axios com JSON default
 * devolve `data` inexploável. Aqui garantimos sempre texto → parse opcional → diagnóstico.
 */
function parseWideVoiceBodyText(rawText) {
  const text = `${rawText ?? ''}`;
  const trimmed = text.replace(/^\ufeff/, '').trim();
  if (!trimmed.length) {
    return { parsed: null, body_effectively_empty_after_trim: true };
  }
  /** Servidor pode devolver o literal JSON `null` (4 caracteres), inválido para statusramais. */
  if (trimmed === 'null') {
    return { parsed: null, body_effectively_empty_after_trim: false, literal_was_json_null: true };
  }
  try {
    const parsed = JSON.parse(trimmed);
    return { parsed, body_effectively_empty_after_trim: false };
  } catch {
    const looksHtml =
      /^<!doctype|^<html|^<\?xml/i.test(trimmed) || /<body[\s>]|<head[\s>]/i.test(trimmed);
    const parsedObj = looksHtml
      ? {
          __widevoice_payload_nao_json: true,
          __forma: 'provavelmente_html_gateway',
          corpo_primeiros_chars: trimmed.slice(0, 340),
          corpo_tamanho: trimmed.length,
        }
      : {
          __widevoice_payload_nao_json: true,
          __forma: 'texto_nao_json',
          corpo_primeiros_chars: trimmed.slice(0, 340),
          corpo_tamanho: trimmed.length,
        };
    return { parsed: parsedObj, body_effectively_empty_after_trim: false };
  }
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

function maskWideVoiceLogin(login) {
  const s = `${login || ''}`.trim();
  if (!s) return null;
  if (s.length <= 8) return `${s.slice(0, 2)}***`;
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

/**
 * Preview seguro das configs usadas pela integração (sem token).
 */
function peekWideVoiceConfig() {
  const origin = `${getBaseOrigin() || ''}`.trim();
  const { login, token } = getCredentials();
  return {
    post_url_preview: origin ? `${origin.replace(/\/+$/, '')}${getApiPath()}` : null,
    login_masked: maskWideVoiceLogin(login),
    token_present: Boolean(`${token || ''}`.trim()),
    timeout_ms: DEFAULT_TIMEOUT_MS,
    dial_plan: {
      local_ddd: `${process.env.INTELBRAS_DIAL_LOCAL_DDD || '11'}`.trim(),
      use_011_for_non_local: dialPlan.use011TrunkForNonLocalDdd(),
      prepend_zero_non_local: dialPlan.clickToCallPrependLeadingZeroForNonLocal(),
      prepend_route_digits: dialPlan.clickToCallPrependRouteDigits() || null,
    },
  };
}

/**
 * @param {{ body_length?: number, content_type?: string|null }} [transport]
 * @returns {{ probe: string, central_status_message: string|null, central_auth_problem: boolean, ramal_snapshot_present: boolean, hint_pt: string, body_sem_conteudo?: boolean, payload_nao_json?: boolean }}
 */
function interpretStatusRamaisProbe(httpStatus, raw, flat, transport = {}) {
  const len =
    typeof transport.body_length === 'number'
      ? transport.body_length
      : Number(transport.body_length) || 0;
  const ctLow = `${transport.content_type ?? ''}`.trim().toLowerCase();
  const bodyEmptyMarked = Boolean(transport.body_effectively_empty_after_trim);

  if (
    httpStatus >= 200 &&
    httpStatus < 300 &&
    (raw === null || raw === undefined) &&
    (bodyEmptyMarked || len === 0)
  ) {
    return {
      probe: 'statusramais',
      central_status_message: null,
      central_auth_problem: false,
      ramal_snapshot_present: false,
      body_sem_conteudo: true,
      hint_pt:
        'HTTP 200 com corpo vazio: confirme a URL (/api.php), proxy/WAF na frente do host Intelbras ou se o método statusramais está activo na sua instância.',
    };
  }

  if (
    httpStatus >= 200 &&
    httpStatus < 300 &&
    (raw === null || raw === undefined) &&
    transport.literal_was_json_null === true
  ) {
    return {
      probe: 'statusramais',
      central_status_message: null,
      central_auth_problem: false,
      ramal_snapshot_present: false,
      resposta_null_literal: true,
      hint_pt:
        'Corpo `null` literal (4 bytes) com Content-Type `text/html`: **não** é a resposta JSON de `statusramais` — não há lista de ramais nem dá para dizer se algum ramal está activo. Normalmente indica URL/host errado, redirecção, ou `api.php` que não serve a API WideVoice nesse domínio; confirme com a Intelbras hostname e path exactos da instância.',
    };
  }

  const nonJsonEnvelope =
    raw &&
    typeof raw === 'object' &&
    '__widevoice_payload_nao_json' in raw &&
    raw.__widevoice_payload_nao_json === true;

  if (nonJsonEnvelope && raw.__forma === 'provavelmente_html_gateway') {
    return {
      probe: 'statusramais',
      central_status_message: null,
      central_auth_problem: false,
      ramal_snapshot_present: false,
      payload_nao_json: true,
      hint_pt:
        'Chegou HTML (gateway, login web ou erro PHP) em vez do JSON esperado pela api.php — ver campo corpo_primeiros_chars em dados.widevoice_raw.',
    };
  }

  const central =
    `${flat?.Status ?? flat?.status ?? ''}`.trim() ||
    (Array.isArray(raw) && raw.length >= 2 ? `${raw[1]}` : '').trim() ||
    null;

  const bundle = `${central || ''}${JSON.stringify(raw || []) || ''}`
    .toLowerCase()
    .replace(/\\/g, '');

  const loginAuthFail =
    /login.*senha|senha.*invalid|invalido/.test(bundle) || /erro de protocolo/.test(bundle);

  /** Sucesso esperado na doc: array de objetos com campo Ramal */
  const looksLikeRamalRows =
    Array.isArray(raw) &&
    raw.length > 0 &&
    typeof raw[0] === 'object' &&
    raw[0] !== null &&
    ('Ramal' in raw[0] || 'ramal' in raw[0]);

  const hintNonJsonFallback =
    nonJsonEnvelope && raw.__forma === 'texto_nao_json'
      ? 'A central devolveu texto que não parseia como JSON (ver pré-visualização em widevoice_raw.corpo_primeiros_chars).'
      : null;

  const hint =
    loginAuthFail
      ? 'Intelbras agrupa falha neste erro: revise token/login com o suporte e confirme o IP de egresso onde corre esta API está cadastrado na instância.'
      : hintNonJsonFallback
        ? hintNonJsonFallback
        : looksLikeRamalRows
          ? 'Resposta típica de statusramais: credencial e IP provavelmente corretos para esta chamada.'
          : httpStatus < 200 || httpStatus >= 300
            ? 'HTTP não-OK recebido do host WideVoice.'
            : ctLow.includes('text/html') &&
                !(Array.isArray(raw) || (raw && typeof raw === 'object' && '__widevoice_payload_nao_json' in raw))
              ? 'Content-Type sugere HTML; verificar redireccionamento HTTPS ou chamada interceptada antes da api.php.'
              : flat && typeof flat.texto_literal === 'string'
                ? 'Resposta primitive JSON string — cenário incomum WideVoice.'
                : 'Interpretação ambígua — inspecionar widevoice_raw e transporte HTTP.';

  const out = {
    probe: 'statusramais',
    central_status_message: central || null,
    central_auth_problem: Boolean(loginAuthFail),
    ramal_snapshot_present: Boolean(looksLikeRamalRows),
    hint_pt: hint,
  };
  if (nonJsonEnvelope && raw.__forma === 'texto_nao_json') {
    out.payload_nao_json = true;
  }
  return out;
}

/**
 * Chamada só de leitura à central (`statusramais`) usando credenciais do ambiente —
 * útil para validar outbound (IP egresso da API) igual ao seu `curl`.
 */
async function probeWideVoiceFromEnv() {
  const meta = peekWideVoiceConfig();
  if (!`${getBaseOrigin() || ''}`.trim() || !meta.token_present) {
    return {
      ok: false,
      code: 'not_configured',
      mensagem_detail:
        'Defina INTELBRAS_WIDEVOICE_BASE_URL, INTELBRAS_WIDEVOICE_LOGIN e INTELBRAS_WIDEVOICE_TOKEN (ou INTELBRAS_REST_*).',
      meta,
    };
  }

  try {
    ensureConfigured();
  } catch (e) {
    return {
      ok: false,
      code: 'not_configured',
      mensagem_detail: String(e?.message || e),
      meta,
    };
  }

  let status;
  let raw;
  let flat;
  /** @type {{ body_length: number; content_type: string|null; body_effectively_empty_after_trim?: boolean }} */
  let transport = {};

  try {
    const r = await statusRamais({});
    ({ status, raw, flat } = r);
    if (typeof r._transport === 'object' && r._transport !== null) {
      transport = r._transport;
    }
  } catch (e) {
    return {
      ok: false,
      code: 'request_failed',
      mensagem_detail: String(e?.message || e),
      meta,
      /** Erros axios costumam trazer causa legível ao operador */
      causa: typeof e?.code === 'string' ? e.code : null,
    };
  }

  const interpretation = interpretStatusRamaisProbe(status, raw, flat, transport);

  return {
    ok: true,
    meta,
    http_status_widevoice: status,
    widevoice_ok: interpretation.ramal_snapshot_present && !interpretation.central_auth_problem,
    widevoice_raw: raw,
    widevoice_flat: flat,
    widevoice_transport: transport,
    ...interpretation,
  };
}

/**
 * @param {string} acao
 * @param {Record<string, unknown>} [extra]
 */
async function wideVoiceAction(acao, extra = {}) {
  const { login, token } = ensureConfigured();
  const { client, apiPath } = ensureHttp();

  const body = {
    ...extra,
    acao,
    login,
    token,
  };

  const res = await client.post(apiPath, body, {
    responseType: 'text',
    transformResponse: [(d) => d],
  });

  const textBuffer = res.data == null ? '' : String(res.data);
  const parseOut = parseWideVoiceBodyText(textBuffer);
  const parsed = parseOut.parsed;
  const body_effectively_empty_after_trim = parseOut.body_effectively_empty_after_trim;

  const flat = flattenWideVoiceResponse(parsed);

  /** @type {{ body_length: number; content_type: string|null; body_effectively_empty_after_trim: boolean; response_text_trimmed_preview?: string; literal_was_json_null?: boolean }} */
  const _transport = {
    body_length: Buffer.byteLength(textBuffer, 'utf8'),
    content_type: res.headers?.['content-type'] ? String(res.headers['content-type']) : null,
    body_effectively_empty_after_trim: Boolean(body_effectively_empty_after_trim),
  };
  if (parseOut.literal_was_json_null === true) {
    _transport.literal_was_json_null = true;
  }

  if (Buffer.byteLength(textBuffer, 'utf8') <= 2048) {
    const trimmedForPreview = textBuffer.replace(/^\ufeff/, '').trim();
    _transport.response_text_trimmed_preview = JSON.stringify(trimmedForPreview.slice(0, 180));
  }

  return { status: res.status, raw: parsed, flat, _transport };
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
 * Data/hora no formato da doc WideVoice (`YYYY-MM-DD HH:mm:ss`) numa timezone IANA.
 */
function formatWideVoiceDateTime(d, timeZone) {
  const tz = `${timeZone ?? process.env.INTELBRAS_WIDEVOICE_TZ ?? 'America/Sao_Paulo'}`.trim();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const g = (t) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}:${g('second')}`;
}

/**
 * Callcenter — login / logout / pausa (doc: `statusoperacoes` + `datainicio` / `datafim`).
 * Se não passar datas, usa janela `INTELBRAS_STATUSOPERACOES_LOOKBACK_MS` (default 24h) até agora.
 */
async function statusOperacoes(extra = {}) {
  const src = typeof extra === 'object' && extra && !Array.isArray(extra) ? { ...extra } : {};
  const tz = `${process.env.INTELBRAS_WIDEVOICE_TZ || 'America/Sao_Paulo'}`.trim();
  let datainicio = `${src.datainicio ?? src.inicio ?? ''}`.trim();
  let datafim = `${src.datafim ?? src.fim ?? ''}`.trim();
  delete src.datainicio;
  delete src.datafim;
  delete src.inicio;
  delete src.fim;

  if (!datainicio || !datafim) {
    const lookbackMs = Math.min(
      86400000 * 7,
      Math.max(
        60000,
        parseInt(String(process.env.INTELBRAS_STATUSOPERACOES_LOOKBACK_MS || '86400000'), 10) || 86400000
      )
    );
    const end = new Date();
    const start = new Date(end.getTime() - lookbackMs);
    if (!datainicio) datainicio = formatWideVoiceDateTime(start, tz);
    if (!datafim) datafim = formatWideVoiceDateTime(end, tz);
  }

  return wideVoiceAction('statusoperacoes', {
    ...src,
    datainicio,
    datafim,
  });
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
  peekWideVoiceConfig,
  probeWideVoiceFromEnv,
  wideVoiceAction,
  clickToCall,
  clickToCallDetailed,
  liberarRamal,
  statusRamais,
  statusOperacoes,
  statusReport,
  hangupSessionMedia,
  formatBrazilDestinationForWideVoice: dialPlan.formatBrazilDestinationForWideVoice,
  desligarPorUniqueId,
};
