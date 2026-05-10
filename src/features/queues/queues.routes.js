const { Router } = require('express');
const queuesController = require('./queues.controller');
const authMiddleware = require('../../middlewares/auth.middleware');

const router = Router();

/** Caminhos específicos antes dos parâmetros dinâmicos. */
router.post('/', authMiddleware, queuesController.join);

router.get('/specialist/:specialistId', queuesController.listForSpecialistPublic);

router.post('/:id/leave', authMiddleware, queuesController.leave);

module.exports = router;
