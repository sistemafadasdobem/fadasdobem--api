'use strict';

/**
 * Leads Agenda: quando uma taróloga passa a ONLINE, notifica leads com interesse registado
 * (`interested_specialist_id` ou `utm_data.interested_specialist_id`) em NEW|QUALIFIED
 * pela conversa WhatsApp no Chatwoot (mensagem pública, não nota privada).
 */

const { Op } = require('sequelize');
const { Lead, Specialist, AuditLog, sequelize } = require('../../models');
const chatwootClient = require('../../providers/chatwoot/chatwoot.client');
const { MSG_LEADS_AGENDA_BOT, formatQueueTemplate } = require('../queues/queue.constants');

function notifyCooldownMs() {
  const h = Number.parseInt(`${process.env.LEADS_AGENDA_NOTIFY_COOLDOWN_HOURS || '24'}`, 10);
  const hours = Number.isFinite(h) && h > 0 ? h : 24;
  return hours * 3600 * 1000;
}

function leadClientDisplayName(lead) {
  const u = lead.utm_data && typeof lead.utm_data === 'object' ? lead.utm_data : {};
  const cand = [
    u.client_name,
    u.contact_name,
    u.primeiro_nome,
    u.nome_primeiro,
    u.display_name,
  ].find((x) => x != null && `${x}`.trim());
  if (cand) return `${cand}`.trim().slice(0, 80);
  const ph = `${lead.phone || ''}`.replace(/\D/g, '');
  if (ph.length >= 4) return ph.slice(-4);
  return 'Cliente';
}

function shouldThrottleLeadForSpecialist(lead, specialistId) {
  const u = lead.utm_data && typeof lead.utm_data === 'object' ? lead.utm_data : {};
  const map =
    u.leads_agenda_notify_by_specialist && typeof u.leads_agenda_notify_by_specialist === 'object'
      ? u.leads_agenda_notify_by_specialist
      : {};
  const lastIso = map[specialistId];
  if (!lastIso || typeof lastIso !== 'string') return false;
  const ts = Date.parse(lastIso);
  return Number.isFinite(ts) && Date.now() - ts < notifyCooldownMs();
}

async function markLeadAgendaNotified(lead, specialistId) {
  const prev = lead.utm_data && typeof lead.utm_data === 'object' ? lead.utm_data : {};
  const prevMap =
    prev.leads_agenda_notify_by_specialist && typeof prev.leads_agenda_notify_by_specialist === 'object'
      ? prev.leads_agenda_notify_by_specialist
      : {};

  await lead.update({
    utm_data: {
      ...prev,
      leads_agenda_notify_by_specialist: {
        ...prevMap,
        [specialistId]: new Date().toISOString(),
      },
    },
  });
}

/**
 * Pesquisa por coluna oficial **ou** `utm_data.interested_specialist_id` (legado até backfill da coluna).
 * @returns {Promise<import('sequelize').Model[]>}
 */
async function findEligibleLeadsForSpecialistOnline(specialistId) {
  const escapedSpec = sequelize.escape(specialistId);
  return Lead.findAll({
    where: {
      [Op.and]: [
        { status: { [Op.in]: ['NEW', 'QUALIFIED'] } },
        { chatwoot_conversation_id: { [Op.ne]: null } },
        {
          [Op.or]: [
            { interested_specialist_id: specialistId },
            sequelize.literal(
              `COALESCE(TRIM(("Lead"."utm_data"->>'interested_specialist_id')),'') = ${escapedSpec}`
            ),
          ],
        },
      ],
    },
    paranoid: true,
  });
}

/**
 * Dispara mensagens públicas (bot) e grava uma linha de auditoria.
 * @returns {Promise<{ matched: number; sent: number; failed: number; throttle_skipped: number; skipped?: string }>}
 */
async function dispatchLeadsAgendaForSpecialistOnline(specialistId) {
  const accountId = `${process.env.CHATWOOT_ACCOUNT_ID || ''}`.trim();
  if (!accountId) {
    console.warn('[leads:agenda] CHATWOOT_ACCOUNT_ID ausente — retomada omitida.');
    return {
      skipped: 'CHATWOOT_ACCOUNT_ID',
      matched: 0,
      sent: 0,
      failed: 0,
      throttle_skipped: 0,
    };
  }

  const specialist = await Specialist.findByPk(specialistId, {
    paranoid: true,
    attributes: ['id', 'display_name'],
  });
  if (!specialist) {
    console.warn('[leads:agenda] especialista inexistente', specialistId);
    return { skipped: 'SPECIALIST', matched: 0, sent: 0, failed: 0, throttle_skipped: 0 };
  }

  const specialistDisplay = `${specialist.display_name || ''}`.trim() || 'sua taróloga';

  const leads = await findEligibleLeadsForSpecialistOnline(specialistId);

  let sent = 0;
  let failed = 0;
  let throttleSkipped = 0;

  /** @type {Array<{ lead_id: string; error: string }>} */
  const errorSample = [];

  for (const lead of leads) {
    if (shouldThrottleLeadForSpecialist(lead, specialistId)) {
      throttleSkipped += 1;
      continue;
    }

    const convId = `${lead.chatwoot_conversation_id || ''}`.trim();
    if (!convId) {
      failed += 1;
      if (errorSample.length < 5) {
        errorSample.push({ lead_id: `${lead.id}`, error: 'sem chatwoot_conversation_id' });
      }
      continue;
    }

    const text = formatQueueTemplate(MSG_LEADS_AGENDA_BOT, {
      client_name: leadClientDisplayName(lead),
      specialist_name: specialistDisplay,
    });

    try {
      await chatwootClient.postTextReply(accountId, convId, text);
      sent += 1;
      await markLeadAgendaNotified(lead, specialistId);
    } catch (err) {
      failed += 1;
      const msg =
        typeof err.response?.data === 'object'
          ? JSON.stringify(err.response.data).slice(0, 300)
          : err?.message || String(err);
      if (errorSample.length < 5) {
        errorSample.push({ lead_id: `${lead.id}`, error: msg.slice(0, 220) });
      }
      console.error('[leads:agenda] Chatwoot post falhou', { leadId: lead.id, msg });
    }
  }

  await AuditLog.create({
    admin_id: null,
    action: 'LEADS_AGENDA_SPECIALIST_ONLINE_NOTIFY',
    target_entity: 'Specialist',
    target_id: specialistId,
    old_value: null,
    new_value: {
      messages_sent: sent,
      messages_failed: failed,
      leads_matched: leads.length,
      throttle_skipped: throttleSkipped,
    },
    metadata: {
      specialist_display: specialistDisplay,
      cooldown_hours: notifyCooldownMs() / 3600000,
      error_sample: errorSample,
    },
    occurred_at: new Date(),
  });

  console.log('[leads:agenda] concluído', {
    specialistId,
    matched: leads.length,
    sent,
    failed,
    throttle_skipped: throttleSkipped,
  });

  return {
    matched: leads.length,
    sent,
    failed,
    throttle_skipped: throttleSkipped,
  };
}

/**
 * Corre após PATCH /me/status → ONLINE — não bloqueia a resposta HTTP.
 */
function scheduleLeadsAgendaDispatchOnTarologaOnline(specialistId) {
  setImmediate(() => {
    dispatchLeadsAgendaForSpecialistOnline(specialistId).catch((err) => {
      console.error('[leads:agenda] job async falhou:', specialistId, err?.stack || err?.message || err);
    });
  });
}

module.exports = {
  dispatchLeadsAgendaForSpecialistOnline,
  scheduleLeadsAgendaDispatchOnTarologaOnline,
  findEligibleLeadsForSpecialistOnline,
};
