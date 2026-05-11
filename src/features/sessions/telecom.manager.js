const agoraClient = require('../../providers/agora/agora.client');
const intelbrasService = require('../../providers/intelbras/intelbras.service');

/**
 * Estratégia unificada: “como encerrar a mídia” sem acoplar ao motor de bilhetagem.
 * @param {import('sequelize').Model} session — instância `Session`.
 * @returns {Promise<{ ok: boolean; provider?: string; detail?: string }>}
 */
async function disconnectSession(session) {
  const prov = `${session.telecom_provider || ''}`.trim().toUpperCase();

  if (prov === 'AGORA') {
    const channel = `${session.provider_channel_id || session.agora_channel_id || ''}`.trim();
    /** Expulsão REST `kicking-rule` (humanos RTC) — dois kicks se cliente e especialista forem UID distintos. */
    const uidsKick = distinctFiniteUids(coerceUid(session.agora_uid_client), coerceUid(session.agora_uid_specialist));
    if (!channel || uidsKick.length === 0) {
      const msg = '[telecom:Agora] disconnectSession — canal ou UID(s) Agora indefinidos.';
      console.warn(msg, { channel, uidsKick });
      return { ok: false, provider: prov, detail: msg };
    }

    let anyOk = false;
    /** @type {string[]} */
    const parts = [];

    for (const uidKick of uidsKick) {
      try {
        console.log('[Agora:Kick] kicking-rule', { channel, uid: uidKick });
        const data = await agoraClient.kickUserFromChannel(channel, uidKick);
        anyOk = true;
        parts.push(`${uidKick}:${typeof data === 'object' ? JSON.stringify(data).slice(0, 240) : String(data)}`);
      } catch (err) {
        console.error('[telecom:Agora] kick falhou:', uidKick, err.response?.data || err.message || err);
        parts.push(`${uidKick}:ERR:${String(err.response?.data || err.message || err).slice(0, 240)}`);
      }
    }

    return { ok: anyOk, provider: prov, detail: parts.join(' | ') };
  }

  if (prov === 'INTELBRAS') {
    try {
      const hang = await intelbrasService.hangupSessionMedia(session);
      return {
        ok: Boolean(hang.ok),
        provider: prov,
        detail: hang.steps?.length ? hang.steps.join(' | ') : 'WideVoice hangup concluído.',
      };
    } catch (err) {
      const detail = `[telecom:Intelbras/WideVoice] hangup falhou: ${err?.message || err}`;
      console.error(detail, { sessionId: session.id });
      return { ok: false, provider: prov, detail };
    }
  }

  if (prov === 'WHATSAPP') {
    const detail = '[telecom:WhatsApp] encerramento de mídia nativo será plugado quando o canal existir.';
    console.warn(detail);
    return { ok: false, provider: prov, detail };
  }

  const detail = `[telecom] provedor não suportado: "${prov}".`;
  console.warn(detail);
  return { ok: false, provider: prov || 'UNKNOWN', detail };
}

function coerceUid(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'bigint') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const n = parseInt(String(raw).trim(), 10);
  return Number.isFinite(n) ? n : null;
}

function distinctFiniteUids(a, b) {
  const list = [];
  if (typeof a === 'number' && Number.isFinite(a)) list.push(a);
  if (typeof b === 'number' && Number.isFinite(b)) {
    const exists = list.some((u) => u === b);
    if (!exists) list.push(b);
  }
  return list;
}

module.exports = {
  disconnectSession,
};
