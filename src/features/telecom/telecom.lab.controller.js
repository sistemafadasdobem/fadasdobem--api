'use strict';

const AppError = require('../../utils/AppError');
const { responderSucesso } = require('../../utils/response.util');
const { catchAsyncRoute } = require('../../utils/catchAsync.util');
const intelbrasService = require('../../providers/intelbras/intelbras.service');

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
    },
    'Laboratório WideVoice ativo.',
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

  const detail = await intelbrasService.clickToCallDetailed({
    origem,
    destino,
    formatDestino,
  });

  if (!detail.success) {
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
  const { status, raw, flat } = await intelbrasService.statusRamais(extra);
  return responderSucesso(
    res,
    { http_status: status, widevoice_raw: raw, widevoice_flat: flat },
    'statusramais consultado.',
    200
  );
});

module.exports = {
  pingLab,
  postClicktocall,
  postLiberarramal,
  postStatusramais,
};
