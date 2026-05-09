const { Router } = require('express');
const authRoutes = require('../features/auth/auth.routes');
const chatwootRoutes = require('../features/chatwoot/chatwoot.routes');
const evolutionRoutes = require('../features/evolution/evolution.routes');
const specialistsRoutes = require('../features/specialists/specialists.routes');
const sessionsRoutes = require('../features/sessions/sessions.routes');
const { responderSucesso } = require('../utils/response.util');
const { API_VERSION_SEMVER } = require('../config/version');

const router = Router();

router.use('/v1/auth', authRoutes);
router.use('/v1/chatwoot', chatwootRoutes);
router.use('/v1/evolution-admin', evolutionRoutes);
router.use('/v1/specialists', specialistsRoutes);
router.use('/v1/sessions', sessionsRoutes);

router.get('/ping', (_req, res) => {
  return responderSucesso(
    res,
    { pong: true, versao: API_VERSION_SEMVER },
    'pong',
    200
  );
});

router.get('/v1/ping', (_req, res) => {
  return responderSucesso(
    res,
    { pong: true, versao: API_VERSION_SEMVER },
    'pong',
    200
  );
});

router.get('/health', (_req, res) => {
  const anthropicApiKeyPresent = Boolean(
    process.env.ANTHROPIC_API_KEY && String(process.env.ANTHROPIC_API_KEY).trim()
  );
  return responderSucesso(
    res,
    {
      servico: 'fadasdobem-api',
      versao: API_VERSION_SEMVER,
      modulo: 'api',
      agrupamento: '/',
      anthropic_api_key_configurada: anthropicApiKeyPresent,
    },
    'API disponível.',
    200
  );
});

router.get('/v1/health', (_req, res) => {
  return responderSucesso(
    res,
    {
      ok: true,
      servico: 'fadasdobem-api',
      versao: API_VERSION_SEMVER,
      rotas: 'v1',
    },
    'Confirmação de rotas versionadas bem-sucedida.',
    200
  );
});

module.exports = router;
