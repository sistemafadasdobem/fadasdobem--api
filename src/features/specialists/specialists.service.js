const { Op, Sequelize } = require('sequelize');
const db = require('../../models');
const AppError = require('../../utils/AppError');

const {
  sequelize,
  Specialist,
  Oracle,
  SpecialistModality,
  SpecialistSchedule,
} = db;
const { scheduleLeadsAgendaDispatchOnTarologaOnline } = require('../leads/leads.agendaAvailability');

const SORT_KEYS = ['ranking', 'status', 'name'];
const MODALITIES = SpecialistModality.MODALITIES;

/** Campos nunca enviados em respostas públicas (lista / perfil público). */
const PUBLIC_HIDDEN_SPECIALIST_ROOT_KEYS = new Set([
  'chave_pix',
  'chave_pix_type',
  'titular_pix_nome',
  'reserved_by_client_id',
  'reserved_until',
  'commission_percent_default',
  'agora_uid',
  'intelbras_ramal',
  'chatwoot_inbox_id',
  'user_id',
]);

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)(:([0-5]\d))?$/;

function pad2(n) {
  const x = Number(n);
  return Number.isFinite(x) ? String(Math.trunc(x)).padStart(2, '0') : '00';
}

/** Normaliza para `HH:mm:ss` válido Postgres ou lança mensagem UX. */
function normalizeTime(raw, label = 'hora') {
  const s = `${raw ?? ''}`.trim();
  const m = s.match(TIME_RE);
  if (!m) {
    throw new AppError(`${label} inválida. Use formato HH:mm ou HH:mm:ss.`, 400, { campo: label }, true);
  }
  const hh = pad2(m[1]);
  const mm = pad2(m[2]);
  const ss = m[4] != null ? pad2(m[4]) : '00';
  return `${hh}:${mm}:${ss}`;
}

function timeToSecs(tstr) {
  const [hh, mm, ss] = tstr.split(':').map(Number);
  return hh * 3600 + mm * 60 + ss;
}

function sanitizeScheduleSlotPublic(slot) {
  if (!slot || typeof slot !== 'object') return slot;
  const { specialist_id: _omit, ...rest } = slot;
  return rest;
}

function sanitizePublicSpecialistRoot(row) {
  if (!row || typeof row !== 'object') return row;
  const out = { ...row };
  PUBLIC_HIDDEN_SPECIALIST_ROOT_KEYS.forEach((k) => {
    delete out[k];
  });
  if (Array.isArray(out.modalidades)) {
    out.modalidades = out.modalidades.map((m) => {
      if (!m || typeof m !== 'object') return m;
      const { specialist_id: _sid, ...rest } = m;
      return rest;
    });
  }
  return out;
}

function sanitizePublicSpecialist(recordPlain) {
  const base = sanitizePublicSpecialistRoot(recordPlain);
  if (!base) return base;
  const clone = { ...base };
  if (Array.isArray(clone.agenda_horarios)) {
    clone.agenda_horarios = clone.agenda_horarios.map(sanitizeScheduleSlotPublic);
  }
  return clone;
}

async function specialistForUser(userId, options = {}) {
  const specialist = await Specialist.findOne({
    where: { user_id: userId },
    ...(options.transaction ? { transaction: options.transaction } : {}),
  });
  return specialist;
}

function parsePagination(query) {
  const rawLimit = Number(query.limit);
  const rawOffset = Number(query.offset);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 20;
  const offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : 0;
  return { limit, offset };
}

function resolveSort(query) {
  const raw = `${query.sort || 'ranking'}`.trim().toLowerCase();
  const sort = SORT_KEYS.includes(raw) ? raw : 'ranking';
  const orderDir = `${query.order || 'desc'}`.trim().toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  return { sort, orderDir };
}

function isUuid(str) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    `${str || ''}`.trim()
  );
}

/**
 * Vitrine: filtros só aplicados quando o parâmetro existe.
 */
async function listForVitrine(query = {}) {
  const trimmedName = query.name != null ? `${query.name}`.trim() : '';
  const trimmedOracle = query.oracle != null ? `${query.oracle}`.trim() : '';
  const rawModality = query.modality != null ? `${query.modality}`.trim().toUpperCase() : '';
  const modalityFilter = MODALITIES.includes(rawModality) ? rawModality : null;

  const { limit, offset } = parsePagination(query);
  const { sort, orderDir } = resolveSort(query);

  const where = { is_blocked: false };

  if (trimmedName) {
    const term = `%${trimmedName.toLowerCase()}%`;
    where[Op.and] = [
      ...(where[Op.and] || []),
      Sequelize.where(Sequelize.fn('LOWER', Sequelize.col('Specialist.display_name')), {
        [Op.iLike]: term,
      }),
    ];
  }

  const oracleWhereClause =
    trimmedOracle !== null &&
    trimmedOracle !== '' &&
    (() => {
      const lo = `${trimmedOracle}`.trim().toLowerCase();
      const parts = [
        Sequelize.where(Sequelize.fn('LOWER', Sequelize.col('oraculos_catalogo.slug')), {
          [Op.eq]: lo,
        }),
      ];
      if (isUuid(`${trimmedOracle}`.trim())) {
        parts.push({ id: `${trimmedOracle}`.trim() });
      }
      return { [Op.or]: parts };
    })();

  const includes = [
    {
      model: SpecialistModality,
      as: 'modalidades',
      required: Boolean(modalityFilter),
      ...(modalityFilter ? { where: { modality: modalityFilter } } : {}),
    },
    {
      model: Oracle,
      as: 'oraculos_catalogo',
      through: { attributes: ['years_using'] },
      required: Boolean(trimmedOracle),
      ...(oracleWhereClause ? { where: oracleWhereClause } : {}),
    },
  ];

  let orderClause;
  if (sort === 'name') {
    orderClause = [[Sequelize.fn('LOWER', Sequelize.col('Specialist.display_name')), orderDir]];
  } else if (sort === 'status') {
    orderClause = [
      [
        Sequelize.literal(`
          CASE "Specialist".status
            WHEN 'ONLINE' THEN 0
            WHEN 'EM_ATENDIMENTO' THEN 1
            WHEN 'AUSENTE' THEN 2
            ELSE 3 END
        `),
        orderDir,
      ],
      ['display_name', 'ASC'],
    ];
  } else {
    orderClause = [
      ['rating_average_cached', orderDir],
      ['reviews_count_cached', orderDir === 'DESC' ? 'DESC' : 'ASC'],
      ['sessions_completed_cached', orderDir === 'DESC' ? 'DESC' : 'ASC'],
    ];
  }

  const { count, rows } = await Specialist.findAndCountAll({
    where,
    include: includes,
    distinct: true,
    col: 'Specialist.id',
    limit,
    offset,
    order: orderClause,
    subQuery: false,
  });

  const especialistas = rows.map((r) => sanitizePublicSpecialistRoot(r.get({ plain: true })));

  return {
    total: count,
    limit,
    offset,
    especialistas,
  };
}

async function getPublicDetailBySpecialistId(specialistId) {
  if (!isUuid(specialistId)) {
    throw new AppError('Identificador de especialista inválido.', 400, null, true);
  }

  const row = await Specialist.findOne({
    where: { id: specialistId, is_blocked: false },
    include: [
      {
        model: SpecialistModality,
        as: 'modalidades',
        required: false,
      },
      {
        model: Oracle,
        as: 'oraculos_catalogo',
        through: { attributes: ['years_using'] },
        required: false,
      },
      {
        model: SpecialistSchedule,
        as: 'agenda_horarios',
        required: false,
        separate: true,
        where: { is_active: true },
        order: [
          ['day_of_week', 'ASC'],
          ['start_time', 'ASC'],
        ],
      },
    ],
  });

  if (!row) {
    throw new AppError('Especialista não encontrada ou indisponível na vitrine.', 404, null, true);
  }

  return sanitizePublicSpecialist(row.get({ plain: true }));
}

async function updateTarologaProfile(userId, body = {}) {
  const specialist = await specialistForUser(userId);
  if (!specialist) {
    throw new AppError('Perfil de taróloga não encontrado.', 404, null, true);
  }

  const patch = {};

  if (Object.prototype.hasOwnProperty.call(body, 'bio')) {
    const v = body.bio;
    patch.bio = v == null || v === '' ? null : String(v).slice(0, 20000);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'greeting_audio_url')) {
    const v = body.greeting_audio_url;
    if (v == null || v === '') {
      patch.greeting_audio_url = null;
    } else {
      const s = String(v).trim().slice(0, 1024);
      patch.greeting_audio_url = s || null;
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'presentation_video_url')) {
    const v = body.presentation_video_url;
    if (v == null || v === '') {
      patch.presentation_video_url = null;
    } else {
      const s = String(v).trim().slice(0, 1024);
      patch.presentation_video_url = s || null;
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'experience_years')) {
    const v = body.experience_years;
    if (v == null || v === '') {
      patch.experience_years = null;
    } else {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 99) {
        throw new AppError('experience_years deve ser inteiro entre 0 e 99.', 400, null, true);
      }
      patch.experience_years = n;
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'timezone')) {
    const tz = `${body.timezone ?? ''}`.trim();
    if (!tz) {
      throw new AppError('timezone não pode ser vazio.', 400, null, true);
    }
    if (tz.length > 64 || !/^[-A-Za-z0-9_/]+$/.test(tz)) {
      throw new AppError('timezone IANA parece inválido.', 400, null, true);
    }
    patch.timezone = tz;
  }

  if (Object.keys(patch).length === 0) {
    throw new AppError('Envie pelo menos um campo válido para actualizar.', 400, null, true);
  }

  await specialist.update(patch);
  return specialist.reload({ include: [{ model: SpecialistModality, as: 'modalidades' }] }).then((s) =>
    s.get({ plain: true })
  );
}

async function updateTarologaStatus(userId, body = {}) {
  const specialist = await specialistForUser(userId);
  if (!specialist) {
    throw new AppError('Perfil de taróloga não encontrado.', 404, null, true);
  }

  const prevStatus = `${specialist.status || ''}`.trim().toUpperCase();

  const raw = `${body.status ?? body.novo_status ?? ''}`.trim().toUpperCase();
  const allowed = Specialist.STATUSES || [];
  if (!raw || !allowed.includes(raw)) {
    throw new AppError(`status inválido. Use um de: ${allowed.join(', ')}.`, 400, null, true);
  }

  const [updated] = await Specialist.update(
    { status: raw },
    {
      where: { user_id: userId },
      individualHooks: true,
    }
  );

  if (!updated) {
    throw new AppError('Perfil de taróloga não encontrado.', 404, null, true);
  }

  if (raw === 'ONLINE' && prevStatus !== 'ONLINE') {
    scheduleLeadsAgendaDispatchOnTarologaOnline(specialist.id);
  }

  return specialist.reload().then((s) => s.get({ plain: true }));
}

/**
 * Extrai lista de slots do corpo: array raiz ou `slots`/`agenda_horarios`/`schedule`.
 */
function extractScheduleSlotsFromBody(body) {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  if (Array.isArray(body)) return body;
  if (Array.isArray(b.slots)) return b.slots;
  if (Array.isArray(b.agenda_horarios)) return b.agenda_horarios;
  if (Array.isArray(b.schedule)) return b.schedule;
  throw new AppError('Envie um array de horários ou o campo `slots`.', 400, null, true);
}

const MAX_SLOTS = 200;

async function replaceTarologaSchedule(userId, body = {}) {
  const specialist = await specialistForUser(userId);
  if (!specialist) {
    throw new AppError('Perfil de taróloga não encontrado.', 404, null, true);
  }

  const slotsRaw = extractScheduleSlotsFromBody(body);

  if (!Array.isArray(slotsRaw)) {
    throw new AppError('Agenda deve ser um array.', 400, null, true);
  }
  if (slotsRaw.length > MAX_SLOTS) {
    throw new AppError(`Limite de ${MAX_SLOTS} blocos de horário por operação.`, 400, null, true);
  }

  const rows = [];

  slotsRaw.forEach((slot, index) => {
    if (!slot || typeof slot !== 'object') {
      throw new AppError(`Slot inválido no índice ${index}.`, 400, null, true);
    }
    const dow = Number(slot.day_of_week);
    if (!Number.isInteger(dow) || dow < 0 || dow > 6) {
      throw new AppError(`day_of_week inválido no índice ${index} (0–6).`, 400, null, true);
    }
    const st = normalizeTime(slot.start_time, `start_time[${index}]`);
    const en = normalizeTime(slot.end_time, `end_time[${index}]`);
    if (timeToSecs(en) <= timeToSecs(st)) {
      throw new AppError(`end_time deve ser maior que start_time no índice ${index}.`, 400, null, true);
    }
    let active = slot.is_active;
    if (active === undefined || active === null) active = true;
    if (typeof active !== 'boolean') {
      const s = `${active}`.trim().toLowerCase();
      if (s !== 'true' && s !== 'false') {
        throw new AppError(`is_active inválido no índice ${index}.`, 400, null, true);
      }
      active = s === 'true';
    }
    rows.push({
      specialist_id: specialist.id,
      day_of_week: dow,
      start_time: st,
      end_time: en,
      is_active: active,
    });
  });

  await sequelize.transaction(async (t) => {
    await SpecialistSchedule.destroy({
      where: { specialist_id: specialist.id },
      transaction: t,
    });
    if (rows.length) {
      await SpecialistSchedule.bulkCreate(rows, { transaction: t, validate: true });
    }
  });

  return SpecialistSchedule.findAll({
    where: { specialist_id: specialist.id, is_active: true },
    order: [
      ['day_of_week', 'ASC'],
      ['start_time', 'ASC'],
    ],
  }).then((list) =>
    list.map((r) =>
      sanitizeScheduleSlotPublic({
        ...r.get({ plain: true }),
      })
    )
  );
}

module.exports = {
  listForVitrine,
  getPublicDetailBySpecialistId,
  updateTarologaProfile,
  updateTarologaStatus,
  replaceTarologaSchedule,
  isUuid,
};
