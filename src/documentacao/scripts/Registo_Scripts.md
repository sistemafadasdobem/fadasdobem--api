# Registo — `scripts/`

## `run-migrations.js`

- Carrega `.env` na raiz do pacote, `sequelize` + `src/models`.
- Lista `migrations/*.js`, ordena lexicograficamente, aplica os que **não** estão em `_schema_migrations`.
- Exporta `runMigrations()` para `app.js` (não fecha a ligação); como CLI (`node scripts/run-migrations.js`) autentica, corre migrações e fecha.
- Ver também `documentacao/migrations/README.md`.

## `seed-dev-homolog.js`

- Comando típico: `npm run seed:homolog` (confirmar em `package.json`).
- Cria utilizador(s) e perfis mínimos para testar Agora/sessões VIDEO; idempotente por e-mail único.
- Variáveis: `SEED_HOMOLOG_EMAIL`, `SEED_HOMOLOG_PASSWORD`, `SEED_HOMOLOG_SPECIALIST_*`, etc.

## `scripts/sql/`

SQL **manual** para bases onde se aplicou remediação pontual (espelha ou antecede migrações):

| Ficheiro | Propósito |
|----------|-----------|
| `fix_transaction_ledger_idempotency_index.sql` | Remove `UNIQUE` global em `idempotency_key` nullable; cria índice único **parcial** (alinhado a `20260208150200-*`). |
| `patch_users_email_pending_review.sql` | Adiciona `users.email_pending_review` se em falta (alinhado a `20260208150100-*`). |

Estes ficheiros servem de *runbook*; o caminho canónico de esquema é **`migrations/*.js`**.
