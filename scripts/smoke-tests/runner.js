#!/usr/bin/env node
'use strict';

/**
 * Orquestrador humano-readable dos smoke tests.
 * Uso: na raíz de `fadasdobem--api`:
 *   ALLOW_SMOKE_TESTS=true DB_NAME=fadas_smoke DATABASE_URL=... REDIS_URL=... npm run smoke
 */

const path = require('path');
const { spawnSync } = require('child_process');

const apiRoot = path.join(__dirname, '..', '..');
const jestConfig = path.join(__dirname, 'jest.config.cjs');
const jestBin = require.resolve('jest/bin/jest');

const DESIGN_OBSERVATIONS = [
  'Mutex ocupado regressa sobretudo como HTTP 503 (SPECIALIST_MUTEX_BUSY); não existe hoje código 429 próprio só para este mutex;',
  '`POST /queues` com vários clientes distintos pode devolver vários 200 (fila válida por cliente); reserved_by_client_id é mais forte em checkout/webhook Mercado Pago;',
  'PendingDelivery grava estado de entrega como `SENT`, não literal `DELIVERED`;',
  'transaction_ledger usa coluna ENUM `reference_type`, não há coluna chamada só `type`;',
  '`trigger_crisis_intervention` grava apenas via HTTP Chatwoot (postPrivateNote); não há tabela local de histórico de notas;',
  '`reconcileStalePendingDeliveries` apenas re‑enfileira PENDING criados há mais de SWEEP_MIN_AGE_MS (≈10 min); válido regressar objeto resumo;',
  'Smoke presume Postgres dedicado + Redis vivo; mocks cobrem Mercado Pago/Agora/Anthropic — nunca ACTIVE contra produção.',
];

console.log('');
console.log('══════════════════════════════════════════════════════════════');
console.log('  Fadas do Bem — Smoke & Stress Harness (Core Engine)');
console.log('══════════════════════════════════════════════════════════════');
console.log('');

const result = spawnSync(process.execPath, [jestBin, '--config', jestConfig, '--runInBand', '--forceExit'], {
  cwd: apiRoot,
  stdio: 'inherit',
  env: { ...process.env },
  encoding: 'utf8',
});

console.log('');
console.log('══════════════════════════════════════════════════════════════');
console.log(`  Estado Jest · código de saída: ${result.status ?? 'indef.'}`);
console.log('══════════════════════════════════════════════════════════════');
console.log('');
console.log('── Observações de design (gatilhos externos / nomenclatura) ──');
DESIGN_OBSERVATIONS.forEach((line, i) => console.log(`${String(i + 1).padStart(2)}. ${line}`));
console.log('');
console.log(`Config: ${jestConfig}`);
console.log('');

process.exit(typeof result.status === 'number' ? result.status : 1);
