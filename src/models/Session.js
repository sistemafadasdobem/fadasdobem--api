const { Model, DataTypes } = require('sequelize');

const SESSION_TELECOM_PROVIDERS = ['AGORA', 'INTELBRAS', 'WHATSAPP'];

/**
 * Ciclo da camada telecom (cronômetro 2+X+2 + NCS/Webhooks).
 * **Distinto** de `sessions.status` (lifecycle operacional: SCHEDULED, READY, …).
 *
 * Equivalente conceitual ao `status` do documento funcional quando ele se refere apenas à sessão média ao vivo.
 */
const SESSION_TELECOM_STATUSES = ['PENDING', 'ACTIVE', 'WARNING', 'COMPLETED', 'ERROR'];

/** Ciclo operacional da consulta agendamento/pagamentos (tabela legacy). */
const SESSION_STATUSES = [
  'SCHEDULED',
  'WAITING_PAYMENT',
  'READY',
  'ACTIVE',
  'ENDED',
  'CANCELLED',
  'NO_SHOW_CLIENT',
  'NO_SHOW_SPECIALIST',
];

const SESSION_MODALITIES = ['TEXTO', 'VOZ', 'VIDEO'];

const SESSION_END_REASONS = [
  'UNKNOWN',
  'NORMAL_COMPLETION',
  'CLIENT_DISCONNECT',
  'SPECIALIST_DISCONNECT',
  'TIMEOUT',
  'BALANCE_ZERO',
  'HARD_CUT_BALANCE_ZERO',
  'PAYMENT_OR_RESERVATION_EXPIRED',
  'CANCELLED_BY_CLIENT',
  'CANCELLED_BY_SPECIALIST',
  'CANCELLED_BY_ADMIN',
  'PLATFORM_ERROR',
  'THIRD_PARTY_SDK_ERROR',
  /** Telecom / auditoria específicos (PostgreSQL ENUM — valores adicionados por migração). */
  'MANUAL',
  'NO_BALANCE_HARD_CUT',
  'NETWORK_ERROR',
];

class Session extends Model {}

module.exports = (sequelize) => {
  Session.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      queue_id: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      client_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      specialist_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      modality: {
        type: DataTypes.ENUM(...SESSION_MODALITIES),
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM(...SESSION_STATUSES),
        allowNull: false,
        defaultValue: 'SCHEDULED',
      },
      started_at: { type: DataTypes.DATE, allowNull: true },
      ended_at: { type: DataTypes.DATE, allowNull: true },
      cron_config_free_intro_minutes: {
        type: DataTypes.DECIMAL(6, 4),
        allowNull: true,
        defaultValue: 2,
        comment:
          'Janelas free “2+X+2”: cortesia inicial antes do X pago (`session.constants.js` sincronizado em 2).',
      },
      cron_config_free_wrap_minutes: {
        type: DataTypes.DECIMAL(6, 4),
        allowNull: true,
        defaultValue: 2,
        comment:
          'Janela de aviso (minutos) antes do zero — alinhar a `WARNING_REMAINING_MINUTES` em código.',
      },
      free_minutes_used: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: 'Progresso inteiro dos minutos de cortesia inicial consumidos (cronômetro 2+X+2).',
      },
      paid_minutes_used: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: 'Minutos inteiros na zona paga já contabilizados para bilhetagem minuto‑a‑minuto.',
      },
      minute_price_applied_snapshot: {
        type: DataTypes.DECIMAL(14, 4),
        allowNull: true,
        comment: 'Valor/min aplicado quando a sessão foi tarifada — blindado contra migrações futuras',
      },
      specialist_commission_pct_snapshot: {
        type: DataTypes.DECIMAL(14, 4),
        allowNull: true,
        comment:
          'Percentual líquido acordado com a especialista no instante da tarifação (% representado decimalmente, ex 25.2500)',
      },
      pricing_level_id_snapshot: { type: DataTypes.UUID, allowNull: true },
      manual_price_override_snapshot: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
      },
      total_cost: {
        type: DataTypes.DECIMAL(14, 4),
        allowNull: false,
        defaultValue: 0,
      },
      platform_fee_amount_snapshot: {
        type: DataTypes.DECIMAL(14, 4),
        allowNull: true,
      },
      specialist_commission_amount_snapshot: {
        type: DataTypes.DECIMAL(14, 4),
        allowNull: true,
      },
      magic_link_token: {
        type: DataTypes.STRING(128),
        allowNull: true,
      },
      magic_link_expires_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      post_session_message: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      chatwoot_conversation_id: { type: DataTypes.STRING(64), allowNull: true },
      /** Legado SIP / AMI — manter até Intelbras ficar só em `intelbras_unique_id`. */
      intelbras_call_id: { type: DataTypes.STRING(128), allowNull: true },
      /** Legado Agora UI — usar `provider_channel_id` quando preenchido. */
      agora_channel_id: { type: DataTypes.STRING(128), allowNull: true },
      agora_rtc_token_cipher: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Preferir TTL curto ou gerar JIT — armazenar só se estritamente necessário',
      },
      telecom_provider: {
        type: DataTypes.STRING(24),
        allowNull: true,
        validate: {
          isIn: {
            args: [SESSION_TELECOM_PROVIDERS],
            msg: 'telecom_provider inválido.',
          },
        },
      },
      /**
       * Identificador de canal único por plataforma: `channelName` (Agora), canal SIP Asterisk ou id lógico.
       */
      provider_channel_id: {
        type: DataTypes.STRING(160),
        allowNull: true,
      },
      agora_uid_client: {
        type: DataTypes.BIGINT,
        allowNull: true,
        comment: 'UID Agora RTC do cliente.',
      },
      agora_uid_specialist: {
        type: DataTypes.BIGINT,
        allowNull: true,
        comment: 'UID Agora RTC da especialista.',
      },
      intelbras_unique_id: {
        type: DataTypes.STRING(128),
        allowNull: true,
        comment: 'Identificador de chamada (ex. Asterisk Uniqueid) quando `telecom_provider = INTELBRAS`.',
      },
      intelbras_bridge_id: {
        type: DataTypes.STRING(160),
        allowNull: true,
        comment: 'Bridge AMI/ARI opcional quando ambos ramos já estão conectados.',
      },
      telecom_status: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: 'PENDING',
        validate: {
          isIn: {
            args: [SESSION_TELECOM_STATUSES],
            msg: 'telecom_status inválido.',
          },
        },
      },
      rtc_end_reason: {
        type: DataTypes.STRING(512),
        allowNull: true,
        comment: 'Payload bruto (ex.: reason Agora em 104) — paralelo ao `ended_reason_code` normalizado.',
      },
      rtc_duration_seconds: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      client_entered_ip: {
        type: DataTypes.STRING(45),
        allowNull: true,
        comment: 'IPv4/IPv6 no momento do join',
      },
      specialist_entered_ip: { type: DataTypes.STRING(45), allowNull: true },
      recording_consent_flag: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
      },
      ended_reason_code: {
        type: DataTypes.ENUM(...SESSION_END_REASONS),
        allowNull: true,
        comment:
          'Encerramento normalizado incluindo `NO_BALANCE_HARD_CUT`, `NETWORK_ERROR`, `MANUAL`.',
      },
      billing_closed_at: { type: DataTypes.DATE, allowNull: true },
      economics_settled_at: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'Liquidações SESSION_CONSUMPTION + COMMISSION_SPLIT idempotentes concluídas',
      },

      billing_track: {
        type: DataTypes.STRING(36),
        allowNull: true,
        comment: 'PACOTE_SESSAO_UNICA | CLIENT_WALLET — fixado ao criar sessão (trilhos exclusivos).',
      },

      consumption_credit_lot_id: {
        type: DataTypes.UUID,
        allowNull: true,
      },

      pacote_opening_remaining_snapshot: {
        type: DataTypes.DECIMAL(14, 4),
        allowNull: true,
        comment: 'Saldo inicial do pacote (BRL) no instante da reserva para esta sessão.',
      },
    },
    {
      sequelize,
      modelName: 'Session',
      tableName: 'sessions',
      paranoid: true,
      indexes: [
        {
          unique: true,
          name: 'sessions_magic_token_deleted_null_uidx',
          fields: ['magic_link_token'],
          where: sequelize.literal('"deleted_at" IS NULL AND "magic_link_token" IS NOT NULL'),
        },
        { fields: ['client_id'] },
        { fields: ['specialist_id'] },
        { fields: ['status'] },
        { fields: ['queue_id'] },
        { fields: ['started_at'] },
        { fields: ['telecom_provider'] },
        { fields: ['telecom_status'] },
      ],
    }
  );

  Session.SESSION_STATUSES = SESSION_STATUSES;
  Session.SESSION_MODALITIES = SESSION_MODALITIES;
  Session.SESSION_END_REASONS = SESSION_END_REASONS;
  Session.TELECOM_PROVIDERS = SESSION_TELECOM_PROVIDERS;
  Session.TELECOM_STATUSES = SESSION_TELECOM_STATUSES;
  Session.LIVE_PROVIDERS = SESSION_TELECOM_PROVIDERS;
  Session.RTC_LIVE_STATUSES = SESSION_TELECOM_STATUSES;

  return Session;
};
