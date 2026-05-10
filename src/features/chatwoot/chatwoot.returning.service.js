'use strict';

const { Op, QueryTypes } = require('sequelize');
const { sequelize, User, Client, LedgerAccount, ClientCreditLot, Session, Queue, Specialist, PricingLevel } = require('../../models');

const SESSION_TELECOM_BUSY = ['PENDING', 'ACTIVE', 'WARNING'];

function phoneDigitsOnly(s) {
  return `${s || ''}`.replace(/\D/g, '');
}

function roundMoney(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

function formatBrl(n) {
  const x = roundMoney(n);
  const s = x.toFixed(2).replace('.', ',');
  return `R$${s}`;
}

/**
 * Localiza cliente (`CLIENTE`) pelo telefone: compara últimos 9 dígitos (BR móvel).
 * @param {string|null|undefined} phoneRaw
 */
async function findUserClienteByPhoneDigits(phoneRaw) {
  const digits = phoneDigitsOnly(phoneRaw);
  if (digits.length < 9) return null;
  const suffix = digits.slice(-9);

  const rows = await sequelize.query(
    `SELECT u.id AS id
       FROM users u
      WHERE u.role = 'CLIENTE'
        AND u.deleted_at IS NULL
        AND u.phone IS NOT NULL
        AND RIGHT(REGEXP_REPLACE(COALESCE(u.phone, ''), '[^0-9]', '', 'g'), 9) = :suffix
      LIMIT 1`,
    { replacements: { suffix }, type: QueryTypes.SELECT }
  );
  if (!Array.isArray(rows) || !rows.length) return null;
  const uid = rows[0].id;
  return User.findByPk(uid, {
    paranoid: true,
    include: [
      {
        model: Client,
        as: 'client_profile',
        required: false,
        include: [{ model: PricingLevel, as: 'pricing_level', required: false }],
      },
    ],
  });
}

async function loadWalletAndLots(clientId) {
  const wallet = await LedgerAccount.findOne({
    where: { client_id: clientId, account_type: 'CLIENT_WALLET' },
  });
  const lots = await ClientCreditLot.findAll({
    where: { client_id: clientId, is_locked: false },
    paranoid: true,
  });
  let avulsoBrl = 0;
  let pacoteBrl = 0;
  for (const lot of lots) {
    const rem = Number(lot.remaining_amount || 0);
    if (rem <= 0) continue;
    if (`${lot.credit_type}` === 'PACOTE_SESSAO_UNICA') pacoteBrl += rem;
    else avulsoBrl += rem;
  }
  const walletBrl = Number(wallet?.cached_balance ?? 0);
  return {
    wallet_row: wallet,
    wallet_brl: roundMoney(walletBrl),
    avulso_brl: roundMoney(avulsoBrl),
    pacote_brl: roundMoney(pacoteBrl),
    /** Saldo em carteira (avulso) + blocos de pacote em R$ — para comprar tempo adicional. */
    usable_brl_total: roundMoney(walletBrl + avulsoBrl + pacoteBrl),
  };
}

async function resolvePricingForClient(clientRow) {
  let pl = clientRow?.pricing_level;
  if (!pl && clientRow?.pricing_level_id) {
    pl = await PricingLevel.findByPk(clientRow.pricing_level_id, { paranoid: true });
  }
  const ppm = pl ? Number(pl.price_text_voice) : 4.49;
  const pvm = pl ? Number(pl.price_video) : 6.49;
  return {
    pricing_level: pl,
    price_text_voice_per_min: Number.isFinite(ppm) && ppm > 0 ? ppm : 4.49,
    price_video_per_min: Number.isFinite(pvm) && pvm > 0 ? pvm : 6.49,
  };
}

/**
 * Minutos de consulta cobertos pelo saldo em R$ ao preço texto/voz do nível.
 */
function minutesCoveredByBalance(usableBrl, pricePerMin) {
  const b = roundMoney(usableBrl);
  const p = Number(pricePerMin) || 1;
  if (b <= 0 || p <= 0) return 0;
  return Math.floor(b / p);
}

async function lastDistinctSpecialistNames(clientId, limit = 3) {
  const rows = await Session.findAll({
    where: { client_id: clientId },
    attributes: ['id', 'specialist_id', 'ended_at', 'started_at'],
    include: [
      {
        model: Specialist,
        as: 'specialist',
        attributes: ['id', 'display_name'],
        required: true,
      },
    ],
    order: [['ended_at', 'DESC'], ['started_at', 'DESC']],
    limit: 40,
    paranoid: true,
  });

  const seen = new Set();
  const names = [];
  for (const r of rows) {
    const sid = `${r.specialist_id || ''}`;
    if (!sid || seen.has(sid)) continue;
    seen.add(sid);
    const nm = `${r.specialist?.display_name || ''}`.trim() || 'Especialista';
    names.push(nm);
    if (names.length >= limit) break;
  }
  return names;
}

/**
 * Fila ativa ou sessão telecom ativa (re-entry 03e).
 */
async function detectReturnReentry(clientId /* uuid */) {
  const waitQ = await Queue.findOne({
    where: { client_id: clientId, status: 'WAITING' },
    order: [['joined_at', 'DESC']],
    paranoid: true,
  });
  if (waitQ) {
    return { active: true, kind: 'queue_waiting', queue_id: waitQ.id, row: waitQ };
  }

  const busyTelecom = { [Op.in]: SESSION_TELECOM_BUSY };
  const liveSession = await Session.findOne({
    where: {
      client_id: clientId,
      telecom_status: busyTelecom,
    },
    order: [['started_at', 'DESC']],
    paranoid: true,
  });
  if (liveSession) {
    return { active: true, kind: 'session_live', session_id: liveSession.id, row: liveSession };
  }

  return { active: false, kind: null };
}

/**
 * Snapshot para nota privada e telas E1/E3.
 */
async function buildReturningClientSnapshot(userInstance) {
  const user = userInstance;
  const client = user?.client_profile;
  if (!client) return null;

  const fin = await loadWalletAndLots(client.id);
  const pricing = await resolvePricingForClient(client);
  const minutesAvail = minutesCoveredByBalance(fin.usable_brl_total, pricing.price_text_voice_per_min);

  const specialistNames = await lastDistinctSpecialistNames(client.id, 3);

  const pl = pricing.pricing_level;
  const levelLabel =
    pl?.name ||
    (pl?.code ? `${pl.code}` : '—');

  return {
    user_id: user.id,
    client_id: client.id,
    nome_exibicao: `${client.nome_id || client.nome_completo || client.nome || client.tratar_por || 'Cliente'}`.trim(),
    nome_id: `${client.nome_id || ''}`.trim() || null,
    pricing_level_label: levelLabel,
    price_text_voice_per_min: pricing.price_text_voice_per_min,
    price_video_per_min: pricing.price_video_per_min,
    wallet_brl: fin.wallet_brl,
    avulso_brl: fin.avulso_brl,
    pacote_brl: fin.pacote_brl,
    usable_brl_total: fin.usable_brl_total,
    display_balance_brl: formatBrl(fin.usable_brl_total),
    minutes_covered_text_voice: minutesAvail,
    last_specialists: specialistNames,
    has_fifteen_plus_minutes: minutesAvail >= 15,
  };
}

function buildAttendantPrivateNote(snapshot) {
  if (!snapshot) return '';
  const tail = snapshot.last_specialists.length
    ? snapshot.last_specialists.join(', ')
    : '(sem histórico recente)';
  return (
    `${snapshot.nome_exibicao} · #${snapshot.nome_id || snapshot.client_id.slice(0, 8)} · ` +
    `Nível: ${snapshot.pricing_level_label} (${formatBrl(snapshot.price_text_voice_per_min)}/min) · ` +
    `Saldo: ${snapshot.display_balance_brl}. ` +
    `Últimas 3 tarólogas: ${tail}.`
  );
}

module.exports = {
  phoneDigitsOnly,
  findUserClienteByPhoneDigits,
  loadWalletAndLots,
  resolvePricingForClient,
  minutesCoveredByBalance,
  lastDistinctSpecialistNames,
  detectReturnReentry,
  buildReturningClientSnapshot,
  buildAttendantPrivateNote,
  formatBrl,
  roundMoney,
};
