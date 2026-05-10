const specialistsService = require('./specialists.service');
const { responderSucesso } = require('../../utils/response.util');
const { catchAsyncRoute } = require('../../utils/catchAsync.util');

module.exports = {
  list: catchAsyncRoute(async (req, res) => {
    const dados = await specialistsService.listForVitrine(req.query);
    return responderSucesso(res, dados, 'Listagem de especialistas.', 200);
  }),

  detailPublic: catchAsyncRoute(async (req, res) => {
    const dados = await specialistsService.getPublicDetailBySpecialistId(req.params.id);
    return responderSucesso(res, dados, 'Perfil público da especialista.', 200);
  }),

  patchMyProfile: catchAsyncRoute(async (req, res) => {
    const dados = await specialistsService.updateTarologaProfile(req.user.id, req.body);
    return responderSucesso(res, dados, 'Perfil actualizado.', 200);
  }),

  patchMyStatus: catchAsyncRoute(async (req, res) => {
    const dados = await specialistsService.updateTarologaStatus(req.user.id, req.body);
    return responderSucesso(res, dados, 'Estado actualizado.', 200);
  }),

  putMySchedule: catchAsyncRoute(async (req, res) => {
    const agenda_horarios = await specialistsService.replaceTarologaSchedule(req.user.id, req.body);
    return responderSucesso(res, { agenda_horarios }, 'Agenda actualizada.', 200);
  }),
};
