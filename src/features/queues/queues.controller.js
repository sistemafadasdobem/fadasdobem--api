const queuesService = require('./queues.service');
const { responderSucesso } = require('../../utils/response.util');
const { catchAsyncRoute } = require('../../utils/catchAsync.util');

module.exports = {
  join: catchAsyncRoute(async (req, res) => {
    const dados = await queuesService.joinQueueAuthenticatedUser(req.user, req.body);
    return responderSucesso(res, dados, 'Entrada na fila registada.', 201);
  }),

  leave: catchAsyncRoute(async (req, res) => {
    const dados = await queuesService.leaveQueueAuthenticatedUser(req.user, req.params.id);
    return responderSucesso(res, dados, 'Saiu da fila.', 200);
  }),

  listForSpecialistPublic: catchAsyncRoute(async (req, res) => {
    const dados = await queuesService.listWaitingForSpecialistPublic(req.params.specialistId);
    return responderSucesso(res, dados, 'Fila de espera atual.', 200);
  }),
};
