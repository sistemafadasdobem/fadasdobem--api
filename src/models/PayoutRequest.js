const { Model, DataTypes } = require('sequelize');

const PAYOUT_STATUSES = ['PENDING', 'APPROVED', 'PROCESSING', 'PAID', 'REJECTED', 'FAILED'];

class PayoutRequest extends Model {}

module.exports = (sequelize) => {
  PayoutRequest.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      specialist_id: { type: DataTypes.UUID, allowNull: false },
      amount: {
        type: DataTypes.DECIMAL(14, 4),
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM(...PAYOUT_STATUSES),
        allowNull: false,
        defaultValue: 'PENDING',
      },
      pix_destination: { type: DataTypes.STRING(256), allowNull: true },
      /** Redundante com destino quando o canal é apenas chave bruta PIX (preferência nova API `/payouts`). */
      pix_key: { type: DataTypes.STRING(256), allowNull: true },
      pix_type: {
        type: DataTypes.STRING(32),
        allowNull: true,
      },
      external_transfer_id: {
        type: DataTypes.STRING(128),
        allowNull: true,
        comment: 'ID do PSP/banco quando integrado',
      },
      rejection_reason: { type: DataTypes.TEXT, allowNull: true },
      processed_by_user_id: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: 'Gestora que aprovou/pagou',
      },
      requested_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      paid_at: { type: DataTypes.DATE, allowNull: true },
      processed_at: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'Eco de processamento efectivo espelho de `paid_at` quando marcação Gestora automatizada',
      },
      metadata: { type: DataTypes.JSONB, allowNull: true },
      gross_reference_amount: {
        type: DataTypes.DECIMAL(14, 4),
        allowNull: true,
        comment: 'Referência opcional antes de tributos/descontos',
      },
      tax_withholding: {
        type: DataTypes.DECIMAL(14, 4),
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'PayoutRequest',
      tableName: 'payout_requests',
      paranoid: true,
      indexes: [
        { fields: ['specialist_id'] },
        { fields: ['status'] },
      ],
    }
  );

  PayoutRequest.PAYOUT_STATUSES = PAYOUT_STATUSES;
  return PayoutRequest;
};
