const { Model, DataTypes } = require('sequelize');

const CREDIT_TYPES = ['AVULSO', 'PACOTE_SESSAO_UNICA'];

class ClientCreditLot extends Model {}

module.exports = (sequelize) => {
  ClientCreditLot.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      client_id: { type: DataTypes.UUID, allowNull: false },
      payment_order_id: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: 'Origem da compra — avulso/pacote',
      },
      credit_type: {
        type: DataTypes.ENUM(...CREDIT_TYPES),
        allowNull: false,
      },
      initial_amount: {
        type: DataTypes.DECIMAL(14, 4),
        allowNull: false,
      },
      remaining_amount: {
        type: DataTypes.DECIMAL(14, 4),
        allowNull: false,
      },
      expires_at: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'Nulo para crédito avulso sem expiração',
      },
      consumed_at: { type: DataTypes.DATE, allowNull: true },
      is_locked: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'Bloqueio administrativo (disputa, chargeback em análise)',
      },
      notes: { type: DataTypes.STRING(512), allowNull: true },

      consumption_modalities: {
        type: DataTypes.JSONB,
        allowNull: true,
        comment:
          "Para PACOTE: ex. `[\"VIDEO\"]` ou `[\"TEXTO\",\"VOZ\"]`. `null`/vazio = compatível com qualquer modalidade (legado).",
      },

      binding_session_id: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: 'Pacote atualmente dedicado à sessão (exclusividade — uma sessão ativa por lote).',
      },

      pacote_closure_session_id: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: 'Última sessão em que o pacote foi encerrado (remanescente queimado).',
      },
    },
    {
      sequelize,
      modelName: 'ClientCreditLot',
      tableName: 'client_credit_lots',
      paranoid: true,
      indexes: [
        { fields: ['client_id'] },
        { fields: ['credit_type'] },
        { fields: ['expires_at'] },
      ],
    }
  );

  ClientCreditLot.CREDIT_TYPES = CREDIT_TYPES;
  return ClientCreditLot;
};
