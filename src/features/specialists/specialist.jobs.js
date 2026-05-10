'use strict';

/**
 * Jobs de especialistas Nice — uso compartilhado com Easypanel (processo único recomendado).
 */

const { Op } = require('sequelize');
const business = require('../../config/business.config');
const { Specialist, AuditLog } = require('../../models');

/**
 * Libera travas `reserved_until` já expiradas (checkout / concorrência).
 */
async function releaseExpiredSpecialistReservationsSweep() {
  const now = new Date();

  const stuck = await Specialist.findAll({
    where: {
      reserved_until: { [Op.ne]: null, [Op.lt]: now },
    },
    attributes: ['id', 'reserved_by_client_id', 'reserved_until'],
    paranoid: true,
  });

  if (!stuck.length) return { cleared: 0, specialist_ids: [] };

  const ids = stuck.map((r) => r.id);

  await Specialist.update(
    { reserved_by_client_id: null, reserved_until: null },
    {
      where: { id: { [Op.in]: ids } },
    }
  );

  await AuditLog.create({
    admin_id: null,
    action: 'SPECIALIST_CLIENT_RESERVATION_EXPIRED_RELEASE',
    target_entity: 'Specialist',
    target_id: null,
    new_value: { released_specialist_ids: ids, cleared: ids.length },
    metadata: {
      reservation_ttl_hint_minutes: business.CLIENT_RESERVATION_MINUTES,
      note:
        '`reserved_until` expirado — housekeeping automático (`specialist.jobs`). O TTL effectivo deve alinhar com CLIENT_RESERVATION_MINUTES onde a reserva é criada.',
    },
    occurred_at: new Date(),
  });

  console.log('[specialists.job] liberações de reserva:', ids.length);

  return { cleared: ids.length, specialist_ids: ids };
}

/**
 * Agenda varredura com intervalo parametrizável em `business.config` (sem intervalo mágico no caller).
 *
 * @returns {NodeJS.Timer}
 */
function scheduleSpecialistReservationSweepJob() {
  const ms = Math.max(
    5_000,
    Number.isFinite(Number(business.SPECIALIST_RESERVATION_JOB_INTERVAL_MS))
      ? Number(business.SPECIALIST_RESERVATION_JOB_INTERVAL_MS)
      : 60_000
  );

  console.log(`[specialists.job] próximo ciclo housekeeping de reservas a cada ${ms}ms.`);

  return setInterval(() => {
    releaseExpiredSpecialistReservationsSweep().catch((err) => {
      console.error('[specialists.job] ciclo housekeeping falhou:', err?.stack || err?.message || err);
    });
  }, ms);
}

module.exports = {
  scheduleSpecialistReservationSweepJob,
  releaseExpiredSpecialistReservationsSweep,
};
