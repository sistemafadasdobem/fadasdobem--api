'use strict';

/**
 * Compat legado: reexporta `intelbras.service.js` (WideVoice `api.php`).
 * Preferir `require('./intelbras.service')` em código novo.
 */

const svc = require('./intelbras.service');

module.exports = {
  clickToCall: svc.clickToCall,
  clickToCallDetailed: svc.clickToCallDetailed,
  /** @deprecated use `clickToCall` */
  originateCall: (ramalOrigem, numeroDestino) =>
    svc.clickToCall({ origem: ramalOrigem, destino: numeroDestino }),
  liberarRamal: svc.liberarRamal,
  statusRamais: svc.statusRamais,
  statusReport: svc.statusReport,
  hangupSessionMedia: svc.hangupSessionMedia,
  formatBrazilDestinationForWideVoice: svc.formatBrazilDestinationForWideVoice,
  hangupCall: async (uniqueId) => svc.desligarPorUniqueId(uniqueId),
};
