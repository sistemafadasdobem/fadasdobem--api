'use strict';

const { Router } = require('express');
const authMiddleware = require('../../middlewares/auth.middleware');
const requireGestoraRole = require('../../middlewares/gestoraRole.middleware');

const adminMetricsController = require('./controllers/admin.metrics.controller');
const adminSpecialistsController = require('./controllers/admin.specialists.controller');
const adminFinanceController = require('./controllers/admin.finance.controller');
const adminUsersController = require('./controllers/admin.users.controller');

const router = Router();

router.use(authMiddleware, requireGestoraRole);

router.get('/metrics/dashboard', adminMetricsController.dashboard);

router.get('/specialists/list', adminSpecialistsController.list);
router.patch('/specialists/approve/:id', adminSpecialistsController.patchApprove);
/** @deprecated alias legado compatível */
router.patch('/specialists/:id/approval', adminSpecialistsController.patchApprove);
router.patch('/specialists/ranking-boost/:id', adminSpecialistsController.patchRankingBoost);

router.get('/finance/transactions', adminFinanceController.transactions);
router.patch('/finance/payouts/:id', adminFinanceController.markPayoutPaid);
router.get('/finance/dashboard', adminFinanceController.pulse);

router.get('/users/search', adminUsersController.search);
router.patch('/users/block/:id', adminUsersController.patchBlock);
/** @deprecated alias legado compatível */
router.patch('/users/:id/block', adminUsersController.patchBlock);

module.exports = router;
