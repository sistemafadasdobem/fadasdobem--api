const { Router } = require('express');
const configController = require('./config.controller');

const router = Router();

router.get('/public', configController.getPublic);

module.exports = router;
