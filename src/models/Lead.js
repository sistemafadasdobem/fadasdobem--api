const { Model, DataTypes } = require('sequelize');

const LEAD_STATUSES = ['NEW', 'QUALIFIED', 'CONVERTED', 'ABANDONED'];

class Lead extends Model {}

module.exports = (sequelize) => {
  Lead.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      chatwoot_contact_id: {
        type: DataTypes.STRING(64),
        allowNull: false,
        comment: 'ID do contacto Chatwoot — chave de deduplicação antes de existir User pagante',
      },
      chatwoot_conversation_id: {
        type: DataTypes.STRING(64),
        allowNull: true,
        comment: 'Conversa atual / última conhecida no Chatwoot',
      },
      phone: {
        type: DataTypes.STRING(32),
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM(...LEAD_STATUSES),
        allowNull: false,
        defaultValue: 'NEW',
      },
      source: {
        type: DataTypes.STRING(64),
        allowNull: false,
        defaultValue: 'direct',
        comment: 'Canal ou origem macro (ex.: whatsapp, google_ads, direct)',
      },
      utm_data: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
        comment: 'UTM e metadados de campanha vindos do webhook / atribuição',
      },
      last_interaction_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      pix_key_suggested: {
        type: DataTypes.STRING(256),
        allowNull: true,
        comment: 'Rascunho de chave PIX antes do cadastro completo (checkout / operação)',
      },
      /**
       * Espelha `users.openai_thread_id`: continuidade da Threads API antes da conversão Lead → User.
       */
      openai_thread_id: {
        type: DataTypes.STRING(128),
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'Lead',
      tableName: 'leads',
      paranoid: true,
      indexes: [
        {
          unique: true,
          name: 'leads_chatwoot_contact_id_deleted_at_null_uidx',
          fields: ['chatwoot_contact_id'],
          where: { deleted_at: null },
        },
        { fields: ['status'] },
        { fields: ['last_interaction_at'] },
        { fields: ['openai_thread_id'] },
      ],
    }
  );

  Lead.LEAD_STATUSES = LEAD_STATUSES;
  return Lead;
};
