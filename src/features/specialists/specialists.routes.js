const { Router } = require('express');
const specialistsController = require('./specialists.controller');
const authMiddleware = require('../../middlewares/auth.middleware');
const requireTarologaRole = require('../../middlewares/tarologaRole.middleware');

const router = Router();

/** Painel taróloga — montar sempre antes das rotas com parâmetro dinâmico `/:id`. */
router.patch(
  '/me/profile',
  authMiddleware,
  requireTarologaRole,
  specialistsController.patchMyProfile
);
router.patch('/me/status', authMiddleware, requireTarologaRole, specialistsController.patchMyStatus);
router.put('/me/schedule', authMiddleware, requireTarologaRole, specialistsController.putMySchedule);

/** Vitrine pública */
router.get('/', specialistsController.list);
router.get('/:id', specialistsController.detailPublic);

module.exports = router;
