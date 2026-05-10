const { sequelize } = require('../config/database');

const User = require('./User')(sequelize);
const OAuthAccount = require('./OAuthAccount')(sequelize);
const UserDevice = require('./UserDevice')(sequelize);
const StaffProfile = require('./StaffProfile')(sequelize);
const Oracle = require('./Oracle')(sequelize);
const PricingLevel = require('./PricingLevel')(sequelize);
const Client = require('./Client')(sequelize);
const ClientDiary = require('./ClientDiary')(sequelize);
const Specialist = require('./Specialist')(sequelize);
const SpecialistModality = require('./SpecialistModality')(sequelize);
const SpecialistOracle = require('./SpecialistOracle')(sequelize);
const SpecialistSchedule = require('./SpecialistSchedule')(sequelize);
const SpecialistStatusLog = require('./SpecialistStatusLog')(sequelize);
const LedgerAccount = require('./LedgerAccount')(sequelize);
const TransactionLedger = require('./TransactionLedger')(sequelize);
const ClientCreditLot = require('./ClientCreditLot')(sequelize);
const PaymentOrder = require('./PaymentOrder')(sequelize);
const PendingDelivery = require('./PendingDelivery')(sequelize);
const PayoutRequest = require('./PayoutRequest')(sequelize);
const Queue = require('./Queue')(sequelize);
const Session = require('./Session')(sequelize);
const Review = require('./Review')(sequelize);
const OTP = require('./OTP')(sequelize);
const RefreshToken = require('./RefreshToken')(sequelize);
const AuditLog = require('./AuditLog')(sequelize);
const PlatformIntegration = require('./PlatformIntegration')(sequelize);
const Lead = require('./Lead')(sequelize);
const BotConversationFlowState = require('./BotConversationFlowState')(sequelize);

/* --- Associações: autenticação e perfil --- */

User.hasMany(OAuthAccount, {
  foreignKey: 'user_id',
  as: 'oauth_accounts',
});

OAuthAccount.belongsTo(User, {
  foreignKey: 'user_id',
  as: 'user',
});

User.hasMany(UserDevice, {
  foreignKey: 'user_id',
  as: 'devices',
});

UserDevice.belongsTo(User, {
  foreignKey: 'user_id',
  as: 'user',
});

User.hasMany(OTP, {
  foreignKey: 'user_id',
  as: 'otps',
});

OTP.belongsTo(User, {
  foreignKey: 'user_id',
  as: 'user',
});

User.hasMany(RefreshToken, {
  foreignKey: 'user_id',
  as: 'refresh_tokens',
});

RefreshToken.belongsTo(User, {
  foreignKey: 'user_id',
  as: 'user',
});

User.hasOne(StaffProfile, {
  foreignKey: 'user_id',
  as: 'staff_profile',
});

StaffProfile.belongsTo(User, {
  foreignKey: 'user_id',
  as: 'user',
});

User.hasMany(AuditLog, {
  foreignKey: 'admin_id',
  as: 'audit_actions',
});

AuditLog.belongsTo(User, {
  foreignKey: 'admin_id',
  as: 'admin_user',
});

User.hasMany(PlatformIntegration, {
  foreignKey: 'configured_by_user_id',
  as: 'integrations_configured',
});

PlatformIntegration.belongsTo(User, {
  foreignKey: 'configured_by_user_id',
  as: 'configured_by_user',
});

/* --- Clientes e níveis --- */

User.hasOne(Client, {
  foreignKey: 'user_id',
  as: 'client_profile',
});

Client.belongsTo(User, {
  foreignKey: 'user_id',
  as: 'user',
});

PricingLevel.hasMany(Client, {
  foreignKey: 'pricing_level_id',
  as: 'clients',
});

Client.belongsTo(PricingLevel, {
  foreignKey: 'pricing_level_id',
  as: 'pricing_level',
});

Client.hasMany(ClientDiary, {
  foreignKey: 'client_id',
  as: 'private_diaries',
});

ClientDiary.belongsTo(Client, {
  foreignKey: 'client_id',
  as: 'client',
});

/* --- Especialistas, vitrine --- */

User.hasOne(Specialist, {
  foreignKey: 'user_id',
  as: 'specialist_profile',
});

Specialist.belongsTo(User, {
  foreignKey: 'user_id',
  as: 'user',
});

Specialist.belongsTo(Client, {
  foreignKey: 'reserved_by_client_id',
  as: 'reserved_by_client',
});

Client.hasMany(Specialist, {
  foreignKey: 'reserved_by_client_id',
  as: 'temporary_reservations_on_specialists',
});

Specialist.hasMany(SpecialistModality, {
  foreignKey: 'specialist_id',
  as: 'modalidades',
});

SpecialistModality.belongsTo(Specialist, {
  foreignKey: 'specialist_id',
  as: 'specialist',
});

Oracle.belongsToMany(Specialist, {
  through: SpecialistOracle,
  foreignKey: 'oracle_id',
  otherKey: 'specialist_id',
  as: 'specialists',
});

Specialist.belongsToMany(Oracle, {
  through: SpecialistOracle,
  foreignKey: 'specialist_id',
  otherKey: 'oracle_id',
  as: 'oraculos_catalogo',
});

SpecialistOracle.belongsTo(Specialist, { foreignKey: 'specialist_id', as: 'specialist' });
SpecialistOracle.belongsTo(Oracle, { foreignKey: 'oracle_id', as: 'oracle' });

Specialist.hasMany(SpecialistSchedule, {
  foreignKey: 'specialist_id',
  as: 'agenda_horarios',
});

SpecialistSchedule.belongsTo(Specialist, {
  foreignKey: 'specialist_id',
  as: 'specialist',
});

Specialist.hasMany(SpecialistStatusLog, {
  foreignKey: 'specialist_id',
  as: 'historico_status',
});

SpecialistStatusLog.belongsTo(Specialist, {
  foreignKey: 'specialist_id',
  as: 'specialist',
});

/** Trilho de SLA / disputas: mudanças de estado operacional. `Model.update(..., { where })` só dispara com `individualHooks: true`. */
Specialist.addHook('afterCreate', async (specialistInstance, opts) => {
  const st = specialistInstance.getDataValue('status');
  if (!st) return;
  try {
    await SpecialistStatusLog.create(
      {
        specialist_id: specialistInstance.id,
        previous_status: null,
        new_status: st,
        changed_at: new Date(),
      },
      { transaction: opts.transaction }
    );
  } catch (err) {
    console.error('[Specialist.afterCreate/status-log]', specialistInstance?.id, err?.message || err);
  }
});

Specialist.addHook('afterUpdate', async (specialistInstance, opts) => {
  const prev = specialistInstance.previous('status');
  const cur = specialistInstance.getDataValue('status');
  if ((prev ?? null) === (cur ?? null) || cur == null) return;
  try {
    await SpecialistStatusLog.create(
      {
        specialist_id: specialistInstance.id,
        previous_status: prev ?? null,
        new_status: cur,
        changed_at: new Date(),
      },
      { transaction: opts.transaction }
    );
  } catch (err) {
    console.error('[Specialist.afterUpdate/status-log]', specialistInstance?.id, err?.message || err);
  }
});

/* --- Contabilidade --- */

Client.hasMany(LedgerAccount, {
  foreignKey: 'client_id',
  as: 'ledger_accounts',
});

LedgerAccount.belongsTo(Client, {
  foreignKey: 'client_id',
  as: 'client',
});

Specialist.hasMany(LedgerAccount, {
  foreignKey: 'specialist_id',
  as: 'ledger_accounts',
});

LedgerAccount.belongsTo(Specialist, {
  foreignKey: 'specialist_id',
  as: 'specialist',
});

TransactionLedger.belongsTo(LedgerAccount, {
  foreignKey: 'debit_account_id',
  as: 'debit_account',
});

TransactionLedger.belongsTo(LedgerAccount, {
  foreignKey: 'credit_account_id',
  as: 'credit_account',
});

LedgerAccount.hasMany(TransactionLedger, {
  foreignKey: 'debit_account_id',
  as: 'debits',
});

LedgerAccount.hasMany(TransactionLedger, {
  foreignKey: 'credit_account_id',
  as: 'credits',
});

TransactionLedger.belongsTo(User, {
  foreignKey: 'created_by_user_id',
  as: 'created_by_user',
});

User.hasMany(TransactionLedger, {
  foreignKey: 'created_by_user_id',
  as: 'ledger_entries_created',
});

/* --- Créditos e pagamentos --- */

Client.hasMany(ClientCreditLot, {
  foreignKey: 'client_id',
  as: 'credit_lotes',
});

ClientCreditLot.belongsTo(Client, {
  foreignKey: 'client_id',
  as: 'client',
});

PaymentOrder.hasMany(ClientCreditLot, {
  foreignKey: 'payment_order_id',
  as: 'credit_lotes',
});

ClientCreditLot.belongsTo(PaymentOrder, {
  foreignKey: 'payment_order_id',
  as: 'payment_order',
});

PaymentOrder.hasMany(PendingDelivery, {
  foreignKey: 'order_id',
  as: 'pending_deliveries',
});

PendingDelivery.belongsTo(PaymentOrder, {
  foreignKey: 'order_id',
  as: 'payment_order',
});

Client.hasMany(PaymentOrder, {
  foreignKey: 'client_id',
  as: 'payments',
});

PaymentOrder.belongsTo(Client, {
  foreignKey: 'client_id',
  as: 'client',
});

PaymentOrder.belongsTo(User, {
  foreignKey: 'user_id',
  as: 'payer_user',
});

User.hasMany(PaymentOrder, {
  foreignKey: 'user_id',
  as: 'payments_as_payer',
});

/* --- Repasses --- */

Specialist.hasMany(PayoutRequest, {
  foreignKey: 'specialist_id',
  as: 'repasses',
});

PayoutRequest.belongsTo(Specialist, {
  foreignKey: 'specialist_id',
  as: 'specialist',
});

PayoutRequest.belongsTo(User, {
  foreignKey: 'processed_by_user_id',
  as: 'processed_by',
});

User.hasMany(PayoutRequest, {
  foreignKey: 'processed_by_user_id',
  as: 'repasses_processed',
});

/* --- Fila e sessões --- */

Client.hasMany(Queue, {
  foreignKey: 'client_id',
  as: 'queues',
});

Queue.belongsTo(Client, {
  foreignKey: 'client_id',
  as: 'client',
});

Specialist.hasMany(Queue, {
  foreignKey: 'specialist_id',
  as: 'queues',
});

Queue.belongsTo(Specialist, {
  foreignKey: 'specialist_id',
  as: 'specialist',
});

Client.hasMany(Session, {
  foreignKey: 'client_id',
  as: 'sessions',
});

Specialist.hasMany(Session, {
  foreignKey: 'specialist_id',
  as: 'sessions',
});

Session.belongsTo(Client, {
  foreignKey: 'client_id',
  as: 'client',
});

Session.belongsTo(Specialist, {
  foreignKey: 'specialist_id',
  as: 'specialist',
});

Session.belongsTo(Queue, {
  foreignKey: 'queue_id',
  as: 'queue',
});

Queue.hasMany(Session, {
  foreignKey: 'queue_id',
  as: 'sessions',
});

Session.hasOne(Review, {
  foreignKey: 'session_id',
  as: 'review',
});

Review.belongsTo(Session, {
  foreignKey: 'session_id',
  as: 'session',
});

Review.belongsTo(Client, {
  foreignKey: 'client_id',
  as: 'client',
});

Client.hasMany(Review, {
  foreignKey: 'client_id',
  as: 'reviews_authored',
});

Review.belongsTo(Specialist, {
  foreignKey: 'specialist_id',
  as: 'specialist',
});

Specialist.hasMany(Review, {
  foreignKey: 'specialist_id',
  as: 'reviews',
});

Specialist.hasMany(Lead, {
  foreignKey: 'interested_specialist_id',
  as: 'agenda_leads_interested',
});

Lead.belongsTo(Specialist, {
  foreignKey: 'interested_specialist_id',
  as: 'interested_specialist',
});

const db = {
  sequelize,
  User,
  OAuthAccount,
  UserDevice,
  StaffProfile,
  Oracle,
  PricingLevel,
  Client,
  ClientDiary,
  Specialist,
  SpecialistModality,
  SpecialistOracle,
  SpecialistSchedule,
  SpecialistStatusLog,
  LedgerAccount,
  TransactionLedger,
  ClientCreditLot,
  PaymentOrder,
  PendingDelivery,
  PayoutRequest,
  Queue,
  Session,
  Review,
  OTP,
  RefreshToken,
  AuditLog,
  PlatformIntegration,
  Lead,
  BotConversationFlowState,
};

module.exports = db;
