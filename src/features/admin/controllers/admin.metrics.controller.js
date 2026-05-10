'use strict';

const { responderSucesso } = require('../../../utils/response.util');
const { catchAsyncRoute } = require('../../../utils/catchAsync.util');
const { getExecutiveDashboardKpis } = require('../admin.metrics.service');

module.exports = {
  /**
   * GET /api/v1/admin/metrics/dashboard
   */
  dashboard: catchAsyncRoute(async (_req, res) => {
    const dados = await getExecutiveDashboardKpis();
    return responderSucesso(res, dados, 'Indicadores executivos Painel Gestora.', 200);
  }),
};
