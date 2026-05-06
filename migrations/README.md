# Migrações PostgreSQL

Ficheiros `*.js` nesta pasta executam **uma vez** por nome (registados em `_schema_migrations`).

## Formato

Cada ficheiro exporta `up({ sequelize, queryInterface, Sequelize })`:

```javascript
'use strict';

module.exports = {
  async up({ sequelize }) {
    await sequelize.query(`/* SQL idempotente */`);
  },
};
```

## Ordem

Prefixo `YYYYMMDDHHMMSS` ou numérico crescente no nome do ficheiro (ex.: `20260208150000-...`).

## Baseline

A primeira migração chama `sequelize.sync({ alter: false })` para **criar só o que falta** em bases novas, com base nos modelos em `src/models`. Alterações em bases já existentes devem ir em migrações seguintes com `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`, etc.

## Execução

- `npm start` — corre migrações e depois sobe a API (`package.json`).
- `npm run migrate` — só migrações.

Defina `SEQUELIZE_SYNC=false` no `.env` em produção e evite `alter: true` na app; o esquema evolui aqui.
