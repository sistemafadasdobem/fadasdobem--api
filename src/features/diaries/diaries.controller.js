'use strict';

const { responderSucesso } = require('../../utils/response.util');
const { catchAsyncRoute } = require('../../utils/catchAsync.util');
const diariesService = require('./diaries.service');

module.exports = {
  postDiary: catchAsyncRoute(async (req, res) => {
    const clientId = await diariesService.diaryContextForClienteUser(req.user);
    const dados = await diariesService.createPrivateDiary(clientId, req.body || {});
    return responderSucesso(res, dados, 'Entrada de diário criada.', 201);
  }),

  listDiaries: catchAsyncRoute(async (req, res) => {
    const clientId = await diariesService.diaryContextForClienteUser(req.user);
    const dados = await diariesService.listPrivateDiaries(clientId, req.query || {});
    return responderSucesso(res, { entradas: dados }, 'Listagem do diário privado.', 200);
  }),
};
