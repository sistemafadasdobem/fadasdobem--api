const { Model, DataTypes } = require('sequelize');

const REF_TYPES = [
  'PAYMENT_TOPUP',
  'PAYMENT_ACCREDITED',
  'SESSION_CONSUMPTION',
  'COMMISSION_SPLIT',
  'REFUND',
  'CHARGEBACK',
  'PAYOUT',
  'ADJUSTMENT_ADMIN',
  'CREDIT_EXPIRY',
  'RESERVATION_HOLD',
  'SYSTEM_FLOOR_ADJUSTMENT',
  'FLOOR_COMPENSATION',
];

class TransactionLedger extends Model {}

module.exports = (sequelize) => {
  TransactionLedger.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      debit_account_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      credit_account_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      amount: {
        type: DataTypes.DECIMAL(14, 4),
        allowNull: false,
        validate: { min: 0 },
        comment: 'Sempre positivo; sentido definido por débito/crédito — precisão BRL estrita',
      },
      reference_type: {
        type: DataTypes.ENUM(...REF_TYPES),
        allowNull: false,
      },
      reference_id: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: 'ID da entidade de origem (sessão, payment_order, payout, etc.)',
      },
      idempotency_key: {
        type: DataTypes.STRING(191),
        allowNull: true,
        comment: 'Evita duplicidade em webhooks e retentativas — unicidade via índice parcial',
      },
      description: { type: DataTypes.STRING(512), allowNull: true },
      metadata: { type: DataTypes.JSONB, allowNull: true },
      occurred_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        comment: 'Momento econômico do evento (pode diferir do created_at)',
      },
      created_by_user_id: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: 'Gestora em lançamentos manuais',
      },
    },
    {
      sequelize,
      modelName: 'TransactionLedger',
      tableName: 'transaction_ledger',
      paranoid: false,
      updatedAt: false,
      timestamps: true,
      createdAt: 'created_at',
      indexes: [
        { fields: ['debit_account_id'] },
        { fields: ['credit_account_id'] },
        { fields: ['reference_type', 'reference_id'] },
        {
          unique: true,
          name: 'transaction_ledger_idempotency_key_not_null_uidx',
          fields: ['idempotency_key'],
          where: sequelize.literal('"idempotency_key" IS NOT NULL'),
        },
      ],
    }
  );

  TransactionLedger.REF_TYPES = REF_TYPES;
  return TransactionLedger;
};
