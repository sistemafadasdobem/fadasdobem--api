'use strict';

/**
 * Cria tabelas e tipos em falta conforme `src/models` — sem `alter` (evita SQL inválido no Postgres).
 * Bases antigas: colunas em falta são corrigidas por migrações posteriores idempotentes.
 */
module.exports = {
  async up({ sequelize }) {
    await sequelize.sync({ alter: false, logging: false });
  },
};
