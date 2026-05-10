'use strict';

function coerceBool(v) {
  if (typeof v === 'boolean') return v;
  const s = `${v ?? ''}`.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'off'].includes(s)) return false;
  return null;
}

module.exports = { coerceBool };
