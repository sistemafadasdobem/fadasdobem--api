'use strict';

const { Op } = require('sequelize');
const db = require('../../models');

const { ClientDiary } = db;
const AppError = require('../../utils/AppError');

const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;
const LIMIT_MAX = 200;

async function diaryContextForClienteUser(userRecord) {
  if (!userRecord || `${userRecord.role || ''}` !== 'CLIENTE') {
    throw new AppError('Diário apenas para clientes.', 403, null, true);
  }
  const cid = userRecord.client_profile?.id;
  if (!cid) {
    throw new AppError('Cliente sem perfil materializado.', 422, null, true);
  }
  return cid;
}

async function createPrivateDiary(clientId, body = {}) {
  const rawDate = `${body.date || body.calendar_date || body.data || ''}`.trim();
  const content = `${body.content || body.text || ''}`.trim();

  if (!content || content.length > 48_000) {
    throw new AppError('`content` é obrigatório (máx. ~48k caracteres).', 400, null, true);
  }
  if (!DATE_ISO.test(rawDate)) {
    throw new AppError('`date` obrigatório no formato ISO YYYY-MM-DD.', 400, null, true);
  }

  const row = await ClientDiary.create({
    client_id: clientId,
    content,
    calendar_date: rawDate,
  });

  return row.get({ plain: true });
}

async function listPrivateDiaries(clientId, query = {}) {
  const rawLimit = Math.min(
    LIMIT_MAX,
    Math.max(1, Number.parseInt(`${query.limit || 90}`, 10) || 90)
  );

  const where = { client_id: clientId };

  const from = `${query.from || query.start || ''}`.trim();
  const to = `${query.to || query.end || ''}`.trim();

  const rng = {};
  if (from && DATE_ISO.test(from)) rng[Op.gte] = from;
  if (to && DATE_ISO.test(to)) rng[Op.lte] = to;
  if (Object.keys(rng).length) {
    where.calendar_date = rng;
  }

  const rows = await ClientDiary.findAll({
    where,
    order: [['calendar_date', 'DESC']],
    limit: rawLimit,
    paranoid: true,
  });

  return rows.map((r) => r.get({ plain: true }));
}

module.exports = {
  diaryContextForClienteUser,
  createPrivateDiary,
  listPrivateDiaries,
};
