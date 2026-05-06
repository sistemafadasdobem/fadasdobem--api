/**
 * Executa ficheiros em `../migrations/*.js` por ordem lexicográfica.
 * Estado em `"_schema_migrations"` na base Postgres (nome do ficheiro = chave única).
 */
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { sequelize } = require('../src/config/database');
require('../src/models'); // registar modelos + associações no mesmo sequelize

const MIG_TABLE = '_schema_migrations';
const migrationsDir = path.join(__dirname, '..', 'migrations');

async function ensureMetaTable() {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS "${MIG_TABLE}" (
      "name" VARCHAR(255) NOT NULL PRIMARY KEY,
      "executed_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function appliedNames() {
  const [rows] = await sequelize.query(`SELECT "name" FROM "${MIG_TABLE}" ORDER BY "name" ASC;`);
  return new Set(rows.map((r) => r.name));
}

async function recordApplied(name) {
  await sequelize.query(`INSERT INTO "${MIG_TABLE}" ("name") VALUES (:name)`, {
    replacements: { name },
  });
}

function listMigrationFiles() {
  if (!fs.existsSync(migrationsDir)) {
    return [];
  }
  return fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.js') && !f.startsWith('.'))
    .sort();
}

async function main() {
  await sequelize.authenticate();
  await ensureMetaTable();
  const done = await appliedNames();
  const files = listMigrationFiles();

  if (!files.length) {
    console.warn('[migrations] Nenhum ficheiro .js em', migrationsDir);
    return;
  }

  for (const file of files) {
    if (done.has(file)) {
      continue;
    }
    const abs = path.join(migrationsDir, file);
    const mod = require(abs);
    if (typeof mod.up !== 'function') {
      console.warn('[migrations] Ignorado (sem up):', file);
      await recordApplied(file);
      continue;
    }

    console.log('[migrations] aplicando ↑', file);
    await mod.up({
      sequelize,
      queryInterface: sequelize.getQueryInterface(),
      Sequelize: require('sequelize'),
    });
    await recordApplied(file);
    delete require.cache[require.resolve(abs)];
  }

  console.log('[migrations] concluído.');
}

(async () => {
  try {
    await main();
  } catch (err) {
    console.error('[migrations] falha:', err);
    process.exitCode = 1;
  } finally {
    try {
      await sequelize.close();
    } catch {
      // ignore
    }
    if (process.exitCode) process.exit(process.exitCode);
  }
})();
