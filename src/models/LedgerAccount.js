const { Model, DataTypes } = require('sequelize');

const ACCOUNT_TYPES = [
  'CLIENT_WALLET',
  /** Pré‑pago pacote sessão única — não usa carteira avulsa. */
  'CLIENT_PACOTE_ESCROW',
  'CLIENT_ESCROW_HOLD',
  'SPECIALIST_EARNINGS',
  'PLATFORM_REVENUE',
  'PLATFORM_SUSPENSE',
  'CHARGEBACK_RESERVE',
];

class LedgerAccount extends Model {}

module.exports = (sequelize) => {
  LedgerAccount.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      account_type: {
        type: DataTypes.ENUM(...ACCOUNT_TYPES),
        allowNull: false,
      },
      client_id: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: 'Dono da carteira — preenchido para contas de cliente',
      },
      specialist_id: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: 'Dono de comissões/repasses — preenchido para contas de especialista',
      },
      currency: {
        type: DataTypes.STRING(3),
        allowNull: false,
        defaultValue: 'BRL',
      },
      label: {
        type: DataTypes.STRING(160),
        allowNull: true,
        comment: 'Descrição administrativa opcional',
      },
      cached_balance: {
        type: DataTypes.DECIMAL(14, 4),
        allowNull: true,
        comment: 'Opcional — saldo cache materializado deve reconciliar contra o ledger',
      },
      last_reconciled_at: { type: DataTypes.DATE, allowNull: true },
    },
    {
      sequelize,
      modelName: 'LedgerAccount',
      tableName: 'ledger_accounts',
      paranoid: false,
      indexes: [
        { fields: ['client_id'] },
        { fields: ['specialist_id'] },
        { fields: ['account_type'] },
      ],
    }
  );

  LedgerAccount.ACCOUNT_TYPES = ACCOUNT_TYPES;
  return LedgerAccount;
};
