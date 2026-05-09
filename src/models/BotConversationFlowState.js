const { Model, DataTypes } = require('sequelize');

class BotConversationFlowState extends Model {}

/**
 * Persistência de estado do Motor de Fluxo (Anthropic via Chatwoot) quando Redis não está disponível.
 */
module.exports = (sequelize) => {
  BotConversationFlowState.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      account_id: {
        type: DataTypes.STRING(32),
        allowNull: false,
      },
      conversation_id: {
        type: DataTypes.STRING(64),
        allowNull: false,
        comment: 'display_id ou id interno da conversa Chatwoot — mesma chave usada na API outbound',
      },
      provider: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: 'anthropic',
      },
      current_state: {
        type: DataTypes.STRING(64),
        allowNull: false,
      },
      slots: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
        comment: 'Dados opcionais do passo (ex.: pacote escolhido) — não versionar prompts aqui',
      },
    },
    {
      sequelize,
      modelName: 'BotConversationFlowState',
      tableName: 'bot_conversation_flow_states',
      underscored: true,
      timestamps: true,
      updatedAt: 'updated_at',
      createdAt: 'created_at',
      indexes: [
        {
          unique: true,
          name: 'bot_flow_acct_conv_uidx',
          fields: ['account_id', 'conversation_id', 'provider'],
        },
      ],
    }
  );

  return BotConversationFlowState;
};
