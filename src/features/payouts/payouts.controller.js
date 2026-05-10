'use strict';

const { responderSucesso } = require('../../utils/response.util');
const { catchAsyncRoute } = require('../../utils/catchAsync.util');
const payoutsService = require('./payouts.service');

module.exports = {
  postRequest: catchAsyncRoute(async (req, res) => {
    const dados = await payoutsService.requestPayout(req.user.id, req.body || {});
    return responderSucesso(res, dados, 'Pedido de repasse registado.', 201);
  }),

  listMine: catchAsyncRoute(async (req, res) => {
    const dados = await payoutsService.listMyPayoutRequests(req.user.id);
    return responderSucesso(res, dados, 'Histórico de saques.', 200);
  }),
};
