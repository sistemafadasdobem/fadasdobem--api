'use strict';

/**
 * Probe público WideVoice — **sem** `INTELBRAS_TELECOM_LAB_*` nem segredo HTTP.
 *
 * Liga/desliga só com INTELBRAS_WIDEVOICE_PUBLIC_PROBE (default: ligado para homologações).
 */

const { Router } = require('express');
const AppError = require('../../utils/AppError');
const { responderSucesso } = require('../../utils/response.util');
const { catchAsyncRoute } = require('../../utils/catchAsync.util');
const intelbrasService = require('../../providers/intelbras/intelbras.service');

const router = Router();

function publicWideVoiceProbeTruthy() {
  const v = `${process.env.INTELBRAS_WIDEVOICE_PUBLIC_PROBE ?? 'true'}`.trim().toLowerCase();
  return !(v === 'false' || v === '0' || v === 'no' || v === 'off');
}

function gatePublicProbe(req, res, next) {
  if (!publicWideVoiceProbeTruthy()) {
    return next(new AppError('WideVoice probe público desligado.', 404, null, true));
  }
  next();
}

router.use(gatePublicProbe);

/** GET /api/v1/telecom/widevoice-check */
const getWidevoicePublicCheck = catchAsyncRoute(async (_req, res) => {
  const out = await intelbrasService.probeWideVoiceFromEnv();

  let mensagem = 'Consulta WideVoice concluída.';
  if (!out.ok && out.code === 'not_configured') {
    mensagem = `${out.mensagem_detail || 'Variáveis WideVoice em falta no ambiente.'}`.slice(0, 520);
  } else if (!out.ok && out.code === 'request_failed') {
    mensagem = `${out.mensagem_detail || 'Falha de rede ou timeout até a central WideVoice.'}`.slice(
      0,
      520
    );
  } else if (out.ok && out.resposta_null_literal) {
    mensagem =
      'Resposta foi só `null` JSON (não há lista de ramais): confirme URL/host da `api.php` com a Intelbras.';
  } else if (out.ok && out.body_sem_conteudo) {
    mensagem =
      'WideVoice devolveu HTTP 200 mas sem corpo JSON útil — ver widevoice_transport, hint_pt e se a api.php/resposta estão bloqueadas por proxy.';
  } else if (out.ok && out.payload_nao_json) {
    mensagem =
      'WideVoice não devolveu JSON (HTML ou texto) — ver widevoice_raw.corpo_primeiros_chars e hint_pt.';
  } else if (out.ok && out.ramal_snapshot_present) {
    mensagem = 'WideVoice aceitou statusramais (credencial/IP de saída deste servidor válidos para a central).';
  } else if (out.ok && out.central_auth_problem) {
    mensagem =
      'WideVoice respondeu com falha típica de login, token ou IP de origem — ver hint_pt e widevoice_raw em dados.';
  }

  return responderSucesso(res, out, mensagem, 200);
});

router.get('/widevoice-check', getWidevoicePublicCheck);

module.exports = router;
