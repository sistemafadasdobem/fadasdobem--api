'use strict';

const { Router } = require('express');
const authMiddleware = require('../../middlewares/auth.middleware');
const { stepUpMiddleware } = require('../../middlewares/stepUp.middleware');
const diariesController = require('./diaries.controller');

const router = Router();

router.post('/', authMiddleware, stepUpMiddleware, diariesController.postDiary);
router.get('/', authMiddleware, stepUpMiddleware, diariesController.listDiaries);

module.exports = router;
