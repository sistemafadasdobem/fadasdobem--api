'use strict';

const { Router } = require('express');
const { requireTelecomLab } = require('../../middlewares/telecom.lab.middleware');
const telecomLabController = require('./telecom.lab.controller');

const router = Router();

router.use(requireTelecomLab);

router.get('/lab/ping', telecomLabController.pingLab);
router.post('/lab/clicktocall', telecomLabController.postClicktocall);
router.post('/lab/liberarramal', telecomLabController.postLiberarramal);
router.post('/lab/statusramais', telecomLabController.postStatusramais);

module.exports = router;
