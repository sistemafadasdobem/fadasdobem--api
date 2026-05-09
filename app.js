const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const routes = require('./src/routes');
const { sequelize } = require('./src/config/database');
const notFoundMiddleware = require('./src/middlewares/notFound.middleware');
const errorHandlerMiddleware = require('./src/middlewares/errorHandler.middleware');
const { responderSucesso } = require('./src/utils/response.util');
const { warmupAssistantsSilent } = require('./src/providers/openai/openai.setup');
const { API_VERSION_SEMVER } = require('./src/config/version');
/** Motor cronômetro 2+X+2 — varredura de saldo não pode derrubar o processo HTTP. */
const sessionChrono = require('./src/features/sessions/session.constants');
const sessionsService = require('./src/features/sessions/sessions.service');
const { runMigrations } = require('./scripts/run-migrations');
require('./src/models');

const app = express();
const port = process.env.PORT || 3000;

if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', Number(process.env.TRUST_PROXY_COUNT) || 1);
}

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

app.use('/api', routes);

app.get('/ping', (_req, res) => {
  return responderSucesso(
    res,
    { pong: true, versao: API_VERSION_SEMVER },
    'pong',
    200
  );
});

app.get('/health', (_req, res) => {
  const anthropicApiKeyPresent = Boolean(
    process.env.ANTHROPIC_API_KEY && String(process.env.ANTHROPIC_API_KEY).trim()
  );
  return responderSucesso(
    res,
    {
      servico: 'fadasdobem-api',
      versao: API_VERSION_SEMVER,
      porta: Number(port),
      anthropic_api_key_configurada: anthropicApiKeyPresent,
    },
    'API disponível.',
    200
  );
});

/**
 * Raiz — health checks de plataforma costumam usar GET / sem path.
 * Evita 404 ruidoso no errorHandler.
 */
app.get('/', (_req, res) => {
  return responderSucesso(
    res,
    {
      servico: 'fadasdobem-api',
      versao: API_VERSION_SEMVER,
      porta: Number(port),
      documentacao_raiz: { health: '/health', ping: '/ping', api: '/api/v1/health' },
    },
    'API no ar. Use /health ou /ping para probes.',
    200
  );
});

/** Browsers pedem favicon por defeito — resposta vazia evita erro 404 nos logs. */
app.get('/favicon.ico', (_req, res) => {
  res.status(204).end();
});

app.use(notFoundMiddleware);
app.use(errorHandlerMiddleware);

async function start() {
  try {
    await sequelize.authenticate();
    await runMigrations();

    const billingMs = Math.max(Number(sessionChrono.BILLING_TICK_INTERVAL_MS) || 10000, 1000);
    console.log(`[BillingEngine] Motor de cobrança rodando (${billingMs}ms).`);
    setInterval(async () => {
      try {
        await sessionsService.runBillingTickSweep();
      } catch (err) {
        console.error('[BillingEngine] tick falhou:', err?.message || err);
      }
    }, billingMs);

    // Esquema: migrações em `migrations/` correm no arranque (ver `runMigrations()` em `start()`).
    // SEQUELIZE_SYNC=true opt-in (dev ou bootstrap manual); evite alter em PRD.
    const syncOn = process.env.SEQUELIZE_SYNC === 'true';
    const useForce = process.env.SEQUELIZE_SYNC_FORCE === 'true';

    if (syncOn || useForce) {
      if (useForce) {
        console.warn(
          '[sequelize] sequelize.sync({ force: true }) irá APAGAR e recriar todas as tabelas.'
        );
        await sequelize.sync({ force: true });
      } else {
        await sequelize.sync({ alter: process.env.SEQUELIZE_SYNC_ALTER === 'true' });
      }
    }

    warmupAssistantsSilent().catch((e) =>
      console.warn('[openai.setup] Aquecimento do assistente ignorado:', e.message)
    );

    app.listen(port, () => {
      console.log(`API escutando na porta ${port}`);
      const {
        scheduleEmailPendingReviewJob,
      } = require('./src/features/auth/auth.emailPending.job');
      scheduleEmailPendingReviewJob();
    });
  } catch (err) {
    console.error('Falha ao iniciar a API:', err);
    process.exit(1);
  }
}

start();

module.exports = app;
