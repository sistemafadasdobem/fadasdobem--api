'use strict';

const { Router } = require('express');
const authMiddleware = require('../../middlewares/auth.middleware');
const requireTarologaRole = require('../../middlewares/tarologaRole.middleware');
const payoutsController = require('./payouts.controller');

const router = Router();

router.post('/request', authMiddleware, requireTarologaRole, payoutsController.postRequest);
router.get('/me', authMiddleware, requireTarologaRole, payoutsController.listMine);

module.exports = router;
