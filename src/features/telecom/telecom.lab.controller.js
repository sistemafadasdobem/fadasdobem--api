'use strict';

const AppError = require('../../utils/AppError');
const { responderSucesso } = require('../../utils/response.util');
const { catchAsyncRoute } = require('../../utils/catchAsync.util');
const intelbrasService = require('../../providers/intelbras/intelbras.service');

/** Fluxo laboratório no terminal Docker (sem token/senhas). */
function labDiag(payload) {
  console.log('[telecom:lab]', payload);
}

const {
  resolveIntelbrasLabPair,
  pairIsReady,
  onlyDigits,
} = require('./telecom.lab.defaults.helper');
const {
  use011TrunkForNonLocalDdd,
  clickToCallPrependLeadingZeroForNonLocal,
  clickToCallPrependRouteDigits,
  clickToCallDropMobileNineAfterDdd,
} = require('../../utils/widevoiceDialPlan.util');

/** GET /api/v1/telecom/lab/ping */
const pingLab = catchAsyncRoute(async (_req, res) => {
  const origin = intelbrasService.getBaseOrigin();
  const configured = Boolean(`${origin || ''}`.trim());
  return responderSucesso(
    res,
    {
      telecom_lab: true,
      widevoice_base_url_configured: configured,
      widevoice_base_preview:
        configured && origin.length > 64 ? `${origin.slice(0, 60)}…` : origin || null,
      api_path: intelbrasService.getApiPath(),
      widevoice_live_check_hint:
        'GET /api/v1/telecom/widevoice-check — probe público (statusramais com .env; sem segredo de laboratório).',
    },
    'Laboratório WideVoice ativo.',
    200
  );
});

/** GET /api/v1/telecom/lab/defaults — dados para pré-preencher o HTML (homologação). */
const getLabDefaults = catchAsyncRoute(async (_req, res) => {
  const pair = await resolveIntelbrasLabPair();
  const masked =
    `${pair.destino_digitos || ''}`.length > 6
      ? `••••${String(pair.destino_digitos || '').slice(-4)}`
      : '';

  const ajudaDestino =
    `${pair.destino_digitos || ''}`.length < 10
      ? `Defina no .env INTELBRAS_LAB_DESTINO=DDI+DDD+NÚMERO (ex. 5511999887766) ou SEED_HOMOLOG_CLIENT_PHONE e rode npm run seed:homolog`
      : null;

  return responderSucesso(
    res,
    {
      origem: pair.origem || '',
      destino: pair.destino || '',
      destino_digitos: pair.destino_digitos || '',
      destino_preview: masked,
      pronto_um_clique: pairIsReady(pair),
      falta_origem: !`${pair.origem || ''}`.trim(),
      falta_destino: `${pair.destino_digitos || ''}`.length < 10,
      ajuda_destino: ajudaDestino,
      destino_variantes: pair.destino_variantes || [],
    },
    'Defaults do laboratório.',
    200
  );
});

/**
 * POST /api/v1/telecom/lab/run-demo — um pedido que valida configs e dispara clicktocall (homologação).
 * Body opcional: { origem?, destino? } sobrepõem defaults só nesta chamada.
 */
const postRunDemo = catchAsyncRoute(async (req, res) => {
  let origem =
    `${req.body?.origem ?? req.body?.origin ?? ''}`.trim();
  let destino = `${req.body?.destino ?? req.body?.destination ?? ''}`.trim();
  const formatDestino =
    req.body?.format_destino !== false &&
    req.body?.formatDestino !== false &&
    req.body?.skip_format !== true;

  const inferred = await resolveIntelbrasLabPair();
  if (!origem) origem = inferred.origem;
  if (!destino) destino = inferred.destino;

  if (!`${origem || ''}`.trim()) {
    throw new AppError(
      'Ramal ausente para demo. Rode `npm run seed:homolog` (preenche `intelbras_ramal`) ou INTELBRAS_LAB_ORIGEM_RAMAL no .env.',
      422,
      {
        especialista_intelbras_hint: inferred.origem ? null : 'sem ramal na BD — ver seed/env',
      },
      true
    );
  }

  const dLen = onlyDigits(destino).length;
  const minDig = formatDestino ? 10 : 1;
  if (!destino || dLen < minDig) {
    throw new AppError(
      formatDestino
        ? 'Telefone destino incompleto. Defina INTELBRAS_LAB_DESTINO ou SEED_HOMOLOG_CLIENT_PHONE (+ seed) até ter ≥10 dígitos.'
        : 'Em modo destino bruto (`skip_format` / `format_destino:false`) é preciso pelo menos 1 dígito em destino.',
      422,
      { digitos_lidos: dLen, format_destino: formatDestino },
      true
    );
  }

  const wideCfg = `${intelbrasService.getBaseOrigin() || ''}`.trim();
  if (!wideCfg) {
    throw new AppError(
      'WideVoice não configurada (INTELBRAS_WIDEVOICE_BASE_URL / credenciais).',
      503,
      null,
      true
    );
  }

  labDiag({
    evento: 'run-demo → wideVoice.clicktocall',
    origem_ramal: origem,
    digitos_destino_informados: onlyDigits(destino).length,
    aplicar_intelbrasDDD: Boolean(formatDestino),
    INTELBRAS_DIAL_LOCAL_DDD: `${process.env.INTELBRAS_DIAL_LOCAL_DDD || '11'}`.trim(),
    INTELBRAS_DIAL_USE_011_FOR_NON_LOCAL: use011TrunkForNonLocalDdd(),
    INTELBRAS_CLICKTOCALL_PREPEND_ZERO: clickToCallPrependLeadingZeroForNonLocal(),
    INTELBRAS_CLICKTOCALL_PREPEND_ROUTE: clickToCallPrependRouteDigits() || undefined,
    INTELBRAS_CLICKTOCALL_DROP_MOBILE_NINE: clickToCallDropMobileNineAfterDdd(),
  });

  const detail = await intelbrasService.clickToCallDetailed({
    origem,
    destino,
    formatDestino,
  });

  if (!detail.success) {
    labDiag({
      evento: 'run-demo falhou · resposta WideVoice',
      http_status_widevoice: detail.http_status,
      destino_discado_servidor: detail.destino_enviado,
      status_flat: detail.widevoice_flat?.Status || detail.widevoice_flat?.status || null,
    });
    const msg =
      `${detail.widevoice_flat?.Mensagem ||
        detail.widevoice_flat?.mensagem ||
        detail.widevoice_flat?.Status ||
        detail.widevoice_flat?.status ||
        'Resposta WideVoice não reconhecida como sucesso.'}`.trim() || 'Falha clicktocall.';
    throw new AppError(msg, detail.http_status >= 400 && detail.http_status < 600 ? detail.http_status : 502, {
      demo: true,
      origem_usada: origem,
      destino_enviado: detail.destino_enviado,
      widevoice_raw: detail.widevoice_raw,
      widevoice_flat: detail.widevoice_flat,
      http_status: detail.http_status,
    }, true);
  }

  labDiag({
    evento: 'run-demo sucesso',
    call_id: detail.call_id || null,
    destino_discado_servidor: detail.destino_enviado,
    origem_ramal: origem,
    dica_nao_tocou:
      'CHAMADA OK só confirma a API. Se não toca: (1) `statusramais` / widevoice-check — ramal origem IDLE. (2) Suporte pode exigir **`015`+DDD+número** → `INTELBRAS_CLICKTOCALL_PREPEND_ROUTE=015` + `PREPEND_ZERO=false`. (3) Formato `011` / `0` / 9 móvel conforme tronco — alinhar com Intelbras. (4) Perfil telefonista / ramal com saída.',
  });

  return responderSucesso(
    res,
    {
      demonstracao_um_clique: true,
      origem_usada: origem,
      call_id: detail.call_id || null,
      destino_enviado: detail.destino_enviado,
      widevoice_raw: detail.widevoice_raw,
      widevoice_flat: detail.widevoice_flat,
      proximo_passo:
        'Se não tocou: statusramais · `destino_enviado` (ex. `015…` vs `07…` vs `011`) com a Intelbras. «Liberar ramal» se SIP preso.',
    },
    'Demonstração WideVoice: CHAMADA OK.',
    200
  );
});

/** POST /api/v1/telecom/lab/clicktocall — body: { origem, destino, format_destino?: boolean } */
const postClicktocall = catchAsyncRoute(async (req, res) => {
  const origem = `${req.body?.origem ?? req.body?.origin ?? ''}`.trim();
  const destino = `${req.body?.destino ?? req.body?.destination ?? ''}`.trim();
  const formatDestino =
    req.body?.format_destino !== false &&
    req.body?.formatDestino !== false &&
    req.body?.skip_format !== true;

  labDiag({ evento: 'POST lab/clicktocall', origem_ramal: origem });

  const detail = await intelbrasService.clickToCallDetailed({
    origem,
    destino,
    formatDestino,
  });

  if (!detail.success) {
    labDiag({
      evento: 'lab/clicktocall falhou',
      http_status_widevoice: detail.http_status,
      destino_discado_servidor: detail.destino_enviado,
    });
    const msg =
      `${detail.widevoice_flat?.Mensagem ||
        detail.widevoice_flat?.mensagem ||
        detail.widevoice_flat?.Status ||
        detail.widevoice_flat?.status ||
        'Resposta WideVoice não reconhecida como sucesso.'}`.trim() || 'Falha clicktocall.';
    throw new AppError(msg, detail.http_status >= 400 && detail.http_status < 600 ? detail.http_status : 502, {
      widevoice_raw: detail.widevoice_raw,
      widevoice_flat: detail.widevoice_flat,
      http_status: detail.http_status,
      destino_enviado: detail.destino_enviado,
    }, true);
  }

  return responderSucesso(
    res,
    {
      call_id: detail.call_id || null,
      destino_enviado: detail.destino_enviado,
      widevoice_raw: detail.widevoice_raw,
      widevoice_flat: detail.widevoice_flat,
    },
    'Click-to-call WideVoice concluído.',
    200
  );
});

/** POST /api/v1/telecom/lab/liberarramal — body: { ramal | origem } */
const postLiberarramal = catchAsyncRoute(async (req, res) => {
  const ramal = `${req.body?.ramal ?? req.body?.origem ?? ''}`.trim();
  const out = await intelbrasService.liberarRamal(ramal);
  return responderSucesso(
    res,
    { ok: true, widevoice_raw: out.raw, widevoice_flat: out.flat },
    'liberarramal executado.',
    200
  );
});

/** POST /api/v1/telecom/lab/statusramais — body opcional mesclado ao payload da API */
const postStatusramais = catchAsyncRoute(async (req, res) => {
  const extra =
    req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const out = await intelbrasService.statusRamais(extra);
  return responderSucesso(
    res,
    {
      http_status: out.status,
      widevoice_raw: out.raw,
      widevoice_flat: out.flat,
      widevoice_transport: out._transport ?? null,
    },
    'statusramais consultado.',
    200
  );
});

/**
 * POST /api/v1/telecom/lab/statusoperacoes — callcenter LOGIN/LOGOUT/pausas (WideVoice doc).
 * Body opc.: { datainicio, datafim } em `YYYY-MM-DD HH:mm:ss`; se omitir, usa últimas 24h (timezone `INTELBRAS_WIDEVOICE_TZ`).
 */
const postStatusOperacoes = catchAsyncRoute(async (req, res) => {
  const extra =
    req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const out = await intelbrasService.statusOperacoes(extra);
  return responderSucesso(
    res,
    {
      http_status: out.status,
      widevoice_raw: out.raw,
      widevoice_flat: out.flat,
      widevoice_transport: out._transport ?? null,
    },
    'statusoperacoes consultado.',
    200
  );
});

module.exports = {
  pingLab,
  getLabDefaults,
  postRunDemo,
  postClicktocall,
  postLiberarramal,
  postStatusramais,
  postStatusOperacoes,
};
