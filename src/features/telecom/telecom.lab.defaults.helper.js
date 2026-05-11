'use strict';

const { User, Specialist } = require('../../models');
const { normalizeEmail } = require('../auth/auth.constants');

function onlyDigits(s) {
  return `${s ?? ''}`.replace(/\D/g, '');
}

/**
 * Lista opcional de outros E.164/nacionais só dígitos — botões rápidos no HTML de laboratório.
 * `INTELBRAS_LAB_DESTINO_VARIANTS=557183141335,5571982809246`
 */
function parseIntelbrasLabDestinoVariants() {
  const raw = `${process.env.INTELBRAS_LAB_DESTINO_VARIANTS || ''}`.trim();
  if (!raw) return [];
  const seen = new Set();
  const out = [];
  for (const part of raw.split(/[,;\n]+/)) {
    const d = onlyDigits(part.trim());
    if (d.length >= 10 && d.length <= 13 && !seen.has(d)) {
      seen.add(d);
      out.push(d);
    }
  }
  return out;
}

/**
 * Origem/destino para o laboratório: prioridade ENV → especialista/cliente seeds homologação.
 */
async function resolveIntelbrasLabPair() {
  const envOrigem = `${process.env.INTELBRAS_LAB_ORIGEM_RAMAL || ''}`.trim();
  const envDestino = `${process.env.INTELBRAS_LAB_DESTINO || ''}`.trim();

  let origem = envOrigem;
  const specSeedEmail = normalizeEmail(
    `${process.env.SEED_HOMOLOG_SPECIALIST_EMAIL || 'tarologa.homolog@fadasdobem.test'}`.trim()
  );
  if (!origem) {
    const u = await User.findOne({ where: { email: specSeedEmail }, attributes: ['id'], paranoid: true });
    if (u) {
      const sp = await Specialist.findOne({
        where: { user_id: u.id },
        attributes: ['intelbras_ramal'],
        paranoid: true,
      });
      origem = `${sp?.intelbras_ramal ?? ''}`.trim();
    }
  }

  let destinoRaw = envDestino;
  const cliSeedEmail = normalizeEmail(`${process.env.SEED_HOMOLOG_EMAIL || 'homolog@fadasdobem.test'}`.trim());
  if (!destinoRaw) {
    const u = await User.findOne({
      where: { email: cliSeedEmail },
      attributes: ['phone'],
      paranoid: true,
    });
    destinoRaw = `${u?.phone ?? ''}`.trim();
  }

  return {
    origem,
    /** Valor cru (pode ter máscara) — `clickToCall` normaliza dígitos. */
    destino: destinoRaw,
    destino_digitos: onlyDigits(destinoRaw),
    ramal_digitos: onlyDigits(origem),
    destino_variantes: parseIntelbrasLabDestinoVariants(),
  };
}

function pairIsReady(pair) {
  const dLen = `${pair.destino_digitos || ''}`.length;
  return Boolean(`${pair.origem || ''}`.trim()) && dLen >= 10 && dLen <= 13;
}

module.exports = {
  resolveIntelbrasLabPair,
  pairIsReady,
  onlyDigits,
};
