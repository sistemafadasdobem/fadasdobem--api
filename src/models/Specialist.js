const { Model, DataTypes } = require('sequelize');

const STATUSES = ['ONLINE', 'EM_ATENDIMENTO', 'AUSENTE', 'OFFLINE'];
const PIX_TYPES = ['EMAIL', 'CPF', 'CNPJ', 'TELEFONE', 'EVP'];
const REG_APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'];

class Specialist extends Model {}

module.exports = (sequelize) => {
  Specialist.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      user_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      display_name: { type: DataTypes.STRING(160), allowNull: true },
      bio: { type: DataTypes.TEXT, allowNull: true },
      avatar_url: { type: DataTypes.STRING(512), allowNull: true },
      cover_image_url: { type: DataTypes.STRING(512), allowNull: true },
      chave_pix: { type: DataTypes.STRING(256), allowNull: true },
      chave_pix_type: { type: DataTypes.ENUM(...PIX_TYPES), allowNull: true },
      titular_pix_nome: { type: DataTypes.STRING(160), allowNull: true },
      status: {
        type: DataTypes.ENUM(...STATUSES),
        allowNull: false,
        defaultValue: 'OFFLINE',
      },
      reserved_by_client_id: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: 'Trava anti-corrida: cliente que reservou a especialista no checkout',
      },
      reserved_until: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'Janela curta (~8min) para concluir pagamento/atribuição',
      },
      experience_years: { type: DataTypes.SMALLINT, allowNull: true },
      greeting_audio_url: {
        type: DataTypes.STRING(1024),
        allowNull: true,
        comment: 'Áudio de boas-vindas público na vitrine (URL signed/CDN)',
      },
      presentation_video_url: {
        type: DataTypes.STRING(1024),
        allowNull: true,
        comment: 'Vídeo de apresentação na vitrine',
      },
      /** IANA; horários da agenda semanal são wall-clock neste fuso (`specialist_schedules`). */
      timezone: {
        type: DataTypes.STRING(64),
        allowNull: false,
        defaultValue: 'America/Sao_Paulo',
      },
      rating_average_cached: {
        type: DataTypes.DECIMAL(3, 2),
        allowNull: true,
        comment: 'Média 1-5 recalculada por job',
      },
      reviews_count_cached: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      sessions_completed_cached: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      vitrine_ordem: { type: DataTypes.INTEGER, allowNull: true },
      accepts_queue_any: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        comment: 'Aceita fila sem especialista pré-selecionada',
      },
      commission_percent_default: {
        type: DataTypes.DECIMAL(5, 2),
        allowNull: true,
        comment: 'Percentual padrão de comissão (sobrescrito por contrato/Nível gestor)',
      },
      agora_uid: { type: DataTypes.STRING(128), allowNull: true },
      intelbras_ramal: { type: DataTypes.STRING(32), allowNull: true },
      chatwoot_inbox_id: { type: DataTypes.STRING(64), allowNull: true },
      is_blocked: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      blocked_reason: { type: DataTypes.TEXT, allowNull: true },
      registration_approval_status: {
        type: DataTypes.STRING(16),
        allowNull: false,
        defaultValue: 'APPROVED',
        validate: {
          isIn: {
            args: [REG_APPROVAL_STATUSES],
            msg: 'registration_approval_status inválido.',
          },
        },
        comment:
          'Workflow cadastro Gestora: PENDING aguardando homologação, APPROVED ativo conforme vínculo `users`, REJECTED recusado.',
      },
      registration_reviewed_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      rank_boost_multiplier: {
        type: DataTypes.DECIMAL(10, 4),
        allowNull: false,
        defaultValue: 1.0,
        comment: 'Factor manual multiplicativo na ordenação editorial da vitrine (≥ 1.0 típico).',
      },
    },
    {
      sequelize,
      modelName: 'Specialist',
      tableName: 'specialists',
      paranoid: true,
      indexes: [
        {
          unique: true,
          name: 'specialists_user_deleted_at_null_uidx',
          fields: ['user_id'],
          where: { deleted_at: null },
        },
        { fields: ['status'] },
        { fields: ['reserved_by_client_id'] },
      ],
    }
  );

  Specialist.STATUSES = STATUSES;
  Specialist.PIX_TYPES = PIX_TYPES;
  Specialist.REG_APPROVAL_STATUSES = REG_APPROVAL_STATUSES;
  return Specialist;
};
