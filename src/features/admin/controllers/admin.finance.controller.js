'use strict';

const { responderSucesso } = require('../../../utils/response.util');
const { catchAsyncRoute } = require('../../../utils/catchAsync.util');
const {
  listFinanceLedgerTransactions,
  markPayoutAsPaid,
  financePulseSummary,
} = require('../services/admin.finance.service');

function httpCtx(req) {
  return {
    ip: req.ip || req.socket?.remoteAddress,
    user_agent: req.headers['user-agent'],
    correlation_id: req.headers['x-request-id'],
  };
}

module.exports = {
  transactions: catchAsyncRoute(async (req, res) => {
    const dados = await listFinanceLedgerTransactions(req.query || {});
    return responderSucesso(res, dados, 'Extrato global Ledger.', 200);
  }),

  markPayoutPaid: catchAsyncRoute(async (req, res) => {
    const dados = await markPayoutAsPaid(req.user.id, req.params.id, req.body || {}, httpCtx(req));
    return responderSucesso(res, dados, 'Repasse marcado como PAGO pela Gestora.', 200);
  }),

  pulse: catchAsyncRoute(async (_req, res) => {
    const dados = await financePulseSummary();
    return responderSucesso(res, dados, 'Finance pulse (rápido, legado compatível).', 200);
  }),
};
