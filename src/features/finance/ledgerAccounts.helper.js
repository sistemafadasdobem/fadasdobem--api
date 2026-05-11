'use strict';

const { Op } = require('sequelize');
const { LedgerAccount } = require('../../models');

/**
 * Conta segregada Pacote sessão única (pré-pago não mistura com carteira avulsa).
 * @param {string} clientId
 * @param {import('sequelize').Transaction} [t]
 */
async function ensureClientPacoteEscrow(clientId, t) {
  const cid = `${clientId || ''}`.trim();
  let acc = await LedgerAccount.findOne({
    where: { client_id: cid, account_type: 'CLIENT_PACOTE_ESCROW' },
    transaction: t,
    lock: t?.LOCK?.UPDATE,
  });
  if (!acc) {
    acc = await LedgerAccount.create(
      {
        client_id: cid,
        account_type: 'CLIENT_PACOTE_ESCROW',
        currency: 'BRL',
        label: 'Pré‑pago — pacote sessão única',
        cached_balance: 0,
      },
      { transaction: t }
    );
  }
  return acc;
}

async function ensurePlatformSuspenseLedger(t) {
  let acc = await LedgerAccount.findOne({
    where: {
      account_type: 'PLATFORM_SUSPENSE',
      client_id: { [Op.is]: null },
      specialist_id: { [Op.is]: null },
    },
    transaction: t,
    lock: t?.LOCK?.UPDATE,
  });
  if (!acc) {
    acc = await LedgerAccount.create(
      {
        account_type: 'PLATFORM_SUSPENSE',
        currency: 'BRL',
        label: 'Suspense — liquidação gateways',
        cached_balance: null,
      },
      { transaction: t }
    );
  }
  return acc;
}

module.exports = {
  ensureClientPacoteEscrow,
  ensurePlatformSuspenseLedger,
};
