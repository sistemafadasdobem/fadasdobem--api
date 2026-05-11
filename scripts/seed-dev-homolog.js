/**
 * Utilizadores e perfis mínimos para homologação (sessões + laboratório Intelbras WideVoice).
 * Idempotente — relançar não duplica (e-mail único).
 *
 * Uso: `npm run seed:homolog`
 */
'use strict';

const path = require('path');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { sequelize } = require('../src/config/database');
const { AUTH_CONFIG } = require('../src/features/auth/auth.constants');
require('../src/models');

const db = require('../src/models');
const { User, Client, Specialist, LedgerAccount } = db;

const HOMOLOG_EMAIL = `${process.env.SEED_HOMOLOG_EMAIL || 'homolog@fadasdobem.test'}`.trim().toLowerCase();
const HOMOLOG_PASSWORD = `${process.env.SEED_HOMOLOG_PASSWORD || 'Homolog@2026'}`;
const SPECIALIST_EMAIL = `${process.env.SEED_HOMOLOG_SPECIALIST_EMAIL || 'tarologa.homolog@fadasdobem.test'}`.trim().toLowerCase();
const SPECIALIST_PASSWORD = `${process.env.SEED_HOMOLOG_SPECIALIST_PASSWORD || 'TarologaHomolog@2026'}`;
const HOMOLOG_INTELBRAS_RAMAL = `${process.env.SEED_HOMOLOG_INTELBRAS_RAMAL || process.env.INTELBRAS_LAB_ORIGEM_RAMAL || '0464'}`.trim();
/** Telefone só para disco de demo no HTML (troca pelo número real onde queres receber testes). */
const HOMOLOG_CLIENT_PHONE = `${process.env.SEED_HOMOLOG_CLIENT_PHONE || process.env.INTELBRAS_LAB_DESTINO || '11999887766'}`.trim();
const COST = AUTH_CONFIG.bcryptCostPassword || 12;

async function ensureUser(email, password, role) {
  let user = await User.findOne({ where: { email } });
  const hash = await bcrypt.hash(password, COST);

  if (!user) {
    user = await User.create({
      email,
      role,
      password_hash: hash,
      is_active: true,
      email_verified_at: new Date(),
      accepted_terms_version: 'homolog-seed',
      accepted_terms_at: new Date(),
    });
    console.log('[seed:homolog] criado User:', email, role);
  } else {
    const updates = {};
    if (!user.password_hash || process.env.SEED_FORCE_PASSWORD_RESET === 'true') {
      updates.password_hash = hash;
    }
    if (String(user.role) !== role) {
      updates.role = role;
    }
    if (!user.email_verified_at) {
      updates.email_verified_at = new Date();
    }
    if (!user.is_active) {
      updates.is_active = true;
    }
    if (Object.keys(updates).length) {
      await user.update(updates);
      console.log('[seed:homolog] atualizado User:', email, Object.keys(updates));
    }
  }
  return User.findOne({ where: { email } });
}

async function main() {
  await sequelize.authenticate();

  const clientUser = await ensureUser(HOMOLOG_EMAIL, HOMOLOG_PASSWORD, 'CLIENTE');
  const specUser = await ensureUser(SPECIALIST_EMAIL, SPECIALIST_PASSWORD, 'TAROLOGA');

  const [clientProf] = await Client.findOrCreate({
    where: { user_id: clientUser.id },
    defaults: {
      user_id: clientUser.id,
      nome: 'Cliente Homologação',
      nickname: 'Cliente Demo',
    },
  });

  const [specProf] = await Specialist.findOrCreate({
    where: { user_id: specUser.id },
    defaults: {
      user_id: specUser.id,
      display_name: 'Taróloga Homologação',
      status: 'ONLINE',
      accepts_queue_any: true,
      intelbras_ramal: HOMOLOG_INTELBRAS_RAMAL,
    },
  });
  await specProf.update({ intelbras_ramal: HOMOLOG_INTELBRAS_RAMAL }).catch(() => {});

  const phoneDigits = HOMOLOG_CLIENT_PHONE.replace(/\D/g, '');
  if (phoneDigits.length >= 10) {
    await clientUser.update({ phone: phoneDigits });
    console.log('[seed:homolog] User cliente.phone (demo WideVoice) · termina em ·' + phoneDigits.slice(-4));
  }

  await LedgerAccount.findOrCreate({
    where: { client_id: clientProf.id, account_type: 'CLIENT_WALLET' },
    defaults: {
      client_id: clientProf.id,
      account_type: 'CLIENT_WALLET',
      currency: 'BRL',
      label: 'Carteira homologação',
      cached_balance: 75.0,
    },
  });

  console.log('');
  console.log('[seed:homolog] OK');
  console.log('  Login cliente :', HOMOLOG_EMAIL);
  console.log('  Senha cliente :', HOMOLOG_PASSWORD);
  console.log('  Login taróloga:', SPECIALIST_EMAIL);
  console.log('  Senha taróloga:', SPECIALIST_PASSWORD);
  console.log('');
  console.log('  specialist_id (POST /sessions):', specProf.id);
  console.log('  intelbras_ramal (troca no .env SEED_* se a Intelbras outro ramal):', HOMOLOG_INTELBRAS_RAMAL);
  console.log(
    '  demo destino WideVoice · via cliente.phone ou INTELBRAS_LAB_DESTINO (troca pelo número real onde queres atender)'
  );
  console.log('');
  await sequelize.close();
}

main().catch((err) => {
  console.error('[seed:homolog] falha:', err);
  process.exit(1);
});
