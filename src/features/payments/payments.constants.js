'use strict';

/** Catálogo opcional de pacotes (sobrescrevido por `MP_PACKAGES_JSON`). */
const DEFAULT_PACKAGES = {
  avulso_demo: {
    amount_brl: 10.0,
    credit_type: 'AVULSO',
    label: 'Recarga demo R$10',
  },
  pacote_50: {
    amount_brl: 50.0,
    credit_type: 'PACOTE_SESSAO_UNICA',
    label: 'Pacote R$50',
    consumption_modalities: ['TEXTO', 'VOZ'],
  },
};

function loadPackageCatalog() {
  const raw = `${process.env.MP_PACKAGES_JSON || ''}`.trim();
  if (!raw) return { ...DEFAULT_PACKAGES };
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed && !Array.isArray(parsed)
      ? parsed
      : { ...DEFAULT_PACKAGES };
  } catch {
    return { ...DEFAULT_PACKAGES };
  }
}

module.exports = {
  loadPackageCatalog,
  DEFAULT_PACKAGES,
};
