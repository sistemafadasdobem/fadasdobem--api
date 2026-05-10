'use strict';

const { randomInt } = require('crypto');
const { User, Client } = require('../../models');
const AppError = require('../../utils/AppError');

const MS_PER_DAY = 86400000;

function parseBirthDateOnly(raw) {
  if (raw == null) return null;
  const d = raw instanceof Date ? raw : new Date(raw);
  if (!Number.isFinite(d.getTime())) return null;
  return d;
}

/** YYYY-MM-DD (UTC)**/
function toIsoDateOnly(d) {
  const y = d.getUTCFullYear();
  const m = `${d.getUTCMonth() + 1}`.padStart(2, '0');
  const da = `${d.getUTCDate()}`.padStart(2, '0');
  return `${y}-${m}-${da}`;
}

/**
 * `@param maxExclusive` formato Node `crypto.randomInt`.
 */
function plausibleRandomDistinctIso(referenceUtc, forbidSet) {
  const mid = parseBirthDateOnly(referenceUtc).getTime();
  let iso;
  let guard = 0;
  do {
    const daySpan = randomInt(-365 * 25, 365 * 25 + 1);
    const jitter = randomInt(-200, 201);
    const candidate = new Date(mid + (daySpan + jitter) * MS_PER_DAY);
    iso = toIsoDateOnly(candidate);
    guard += 1;
  } while (forbidSet.has(iso) && guard < 80);
  return iso;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = randomInt(0, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function phoneDigitsOnly(s) {
  return `${s || ''}`.replace(/\D/g, '');
}

/**
 * Segunda camada de identificação: três “fins” de número (1 real mascarado + 2 fakes).
 * Os `rowId` são estáveis para o WhatsApp (`fsm:iden:ph:*`).
 *
 * @returns {{ options: Array<{ rowId: string, label: string, tail: string }>, correct_row_id: string }}
 */
function generatePhoneTailChallenge(phoneRaw) {
  const d = phoneDigitsOnly(phoneRaw);
  if (d.length < 8) {
    throw new AppError('Telefone insuficiente para criar desafio de confirmação.', 422, null, true);
  }
  const realTail = d.slice(-4);
  const tails = new Set([realTail]);
  let guard = 0;
  while (tails.size < 3 && guard < 200) {
    guard += 1;
    const cand = `${randomInt(0, 10000)}`.padStart(4, '0');
    if (cand !== realTail) tails.add(cand);
  }
  const trio = shuffle([...tails]);
  const options = trio.map((tail) => ({
    rowId: `fsm:iden:ph:tail:${tail}`,
    label: `(**) ****-${tail}`,
    tail,
  }));
  const correct = options.find((o) => o.tail === realTail);
  return {
    options,
    correct_row_id: correct ? correct.rowId : options[0].rowId,
  };
}

/**
 * Regra A1/A2: três datas (uma correcta na BD); ordem já embaralhada para o Chatwoot.
 *
 * @param {string} userId
 */
async function generateIdentityChallenge(userId) {
  const uid = `${userId || ''}`.trim();
  const user = await User.findByPk(uid, {
    attributes: ['id', 'role'],
    include: [{ model: Client, as: 'client_profile', required: false, attributes: ['data_nascimento'] }],
    paranoid: true,
  });

  if (!user) {
    throw new AppError('Utilizador não encontrado.', 404, null, true);
  }
  if (`${user.role || ''}`.trim().toUpperCase() !== 'CLIENTE') {
    throw new AppError('Verificação de identidade apenas para perfil cliente.', 403, null, true);
  }

  const dob = user.client_profile?.data_nascimento;
  const canonicalDate = dob ? parseBirthDateOnly(dob) : null;
  if (!canonicalDate) {
    throw new AppError('Data de nascimento não registada neste cliente — não é possível criar desafio A1.', 422, null, true);
  }

  const canonIso = toIsoDateOnly(canonicalDate);
  const forbid = new Set([canonIso]);

  const d1Iso = plausibleRandomDistinctIso(canonicalDate, forbid);
  forbid.add(d1Iso);

  let d2Iso = plausibleRandomDistinctIso(canonicalDate, forbid);

  /** Desempate raro quando colisões extremas repetem datas */
  if (forbid.has(d2Iso) || d2Iso === canonIso || d2Iso === d1Iso) {
    forbid.add(d2Iso);
    d2Iso = plausibleRandomDistinctIso(canonicalDate, forbid);
  }

  const trio = shuffle([
    { iso: canonIso },
    { iso: d1Iso },
    { iso: d2Iso },
  ]);

  return {
    options: trio,
    canonical_iso: canonIso,
  };
}

module.exports = {
  generateIdentityChallenge,
  generatePhoneTailChallenge,
  toIsoDateOnly,
};
