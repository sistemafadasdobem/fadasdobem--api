'use strict';

const business = require('../config/business.config');

/**
 * Deriva `nome_id` exibível a partir do nome completo, conforme `NAME_ID_GENERATION_LOGIC` em `business.config.js`.
 *
 * @param {string|null|undefined} nomeCompleto
 * @param {string} [logicOverride] — ex.: `FIRST_AND_LAST`
 * @returns {string|null}
 */
function deriveNomeIdFromNomeCompleto(nomeCompleto, logicOverride) {
  const logic = `${logicOverride || business.NAME_ID_GENERATION_LOGIC || 'FIRST_AND_LAST'}`.toUpperCase();
  const s = `${nomeCompleto ?? ''}`.trim().replace(/\s+/g, ' ');
  if (!s) return null;

  const parts = s.split(' ');

  switch (logic) {
    case 'FIRST_ONLY':
      return parts[0] ? parts[0].slice(0, 160) : null;
    case 'FULL_COMPACT':
      return s.slice(0, 160);
    case 'FIRST_AND_LAST':
    default:
      if (parts.length <= 1) return parts[0] ? parts[0].slice(0, 160) : null;
      return `${parts[0]} ${parts[parts.length - 1]}`.slice(0, 160);
  }
}

module.exports = {
  deriveNomeIdFromNomeCompleto,
};
