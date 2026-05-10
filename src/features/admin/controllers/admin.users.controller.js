'use strict';

const { responderSucesso } = require('../../../utils/response.util');
const { catchAsyncRoute } = require('../../../utils/catchAsync.util');
const { searchClientAccounts, patchUserSuspend } = require('../services/admin.users.service');

function httpCtx(req) {
  return {
    ip: req.ip || req.socket?.remoteAddress,
    user_agent: req.headers['user-agent'],
    correlation_id: req.headers['x-request-id'],
  };
}

module.exports = {
  search: catchAsyncRoute(async (req, res) => {
    const dados = await searchClientAccounts(req.query || {});
    return responderSucesso(res, { items: dados, count: dados.length }, 'Busca Gestora sobre clientes.', 200);
  }),

  patchBlock: catchAsyncRoute(async (req, res) => {
    const dados = await patchUserSuspend(req.user.id, req.params.id, req.body || {}, httpCtx(req));
    return responderSucesso(res, dados, 'Conta actualizada pela Gestora.', 200);
  }),
};
