const { Model, DataTypes } = require('sequelize');

const ORDER_STATUSES = [
  'PENDING',
  'PROCESSING',
  'PAID',
  'FAILED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
  'CHARGEBACK',
  'CANCELLED',
];

const PAYMENT_METHODS = ['PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'WALLET_MP', 'UNKNOWN'];

const MP_NFE_STATUSES = ['PENDING', 'ISSUED', 'ERROR'];

class PaymentOrder extends Model {}

module.exports = (sequelize) => {
  PaymentOrder.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      client_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      user_id: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: 'Pagador quando difere da titularidade (proxy, menor assistido)',
      },
      external_reference: {
        type: DataTypes.STRING(191),
        allowNull: false,
        comment:
          'Referência idempotente própria (Payment API / Orders API). Mantida para correlacionar webhooks e criar registros apenas uma vez.',
      },
      idempotency_key_internal: {
        type: DataTypes.STRING(191),
        allowNull: true,
        comment: 'Opcional quando o próprio Checkout expõe chave paralela ao external_reference.',
      },
      /** Valor solicitado pela plataforma (bruto antes de distribuições internas). */
      amount: {
        type: DataTypes.DECIMAL(14, 4),
        allowNull: false,
      },
      /** Bruto confirmado pelo MP (`transaction_amount` no GET /v1/payments). */
      mp_transaction_amount: {
        type: DataTypes.DECIMAL(14, 4),
        allowNull: true,
      },
      /** Pacote / tipo de crédito escolhido no checkout (JSON). */
      checkout_context: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
      currency: {
        type: DataTypes.STRING(3),
        allowNull: false,
        defaultValue: 'BRL',
      },
      status: {
        type: DataTypes.ENUM(...ORDER_STATUSES),
        allowNull: false,
        defaultValue: 'PENDING',
        comment:
          'Status interno canonizado pela Fadas do Bem (derivado de webhooks/processamento). Diverge conscientemente dos textos crus do gateway.',
      },
      payment_method: {
        type: DataTypes.ENUM(...PAYMENT_METHODS),
        allowNull: true,
        comment: 'Classificação amigável usada pela plataforma; detalha em mp_payment_*.',
      },

      mp_payment_id: {
        type: DataTypes.STRING(64),
        allowNull: true,
        comment:
          'ID oficial do Payments API (valor numérico do MP sempre como string para evitar perda em JS)',
      },
      mp_merchant_order_id: {
        type: DataTypes.STRING(64),
        allowNull: true,
        comment: 'ID do recurso Merchant Order / pedido pai quando disponível nos webhooks',
      },
      mp_payment_method_id: {
        type: DataTypes.STRING(64),
        allowNull: true,
        comment: "Identificação fina (`payment_method.id`, ex.: 'pix', 'master', 'visa')",
      },
      mp_payment_type_id: {
        type: DataTypes.STRING(64),
        allowNull: true,
        comment: 'Tipo agregador (`credit_card`, `bank_transfer`, ...)',
      },
      mp_status: {
        type: DataTypes.STRING(64),
        allowNull: true,
        comment:
          'Status espelho fiel ao gateway (`approved`, `rejected`, `in_process`, `refunded`, `charged_back`...)',
      },
      mp_status_detail: {
        type: DataTypes.STRING(256),
        allowNull: true,
        comment:
          'Campo granular do MP (`cc_rejected_bad_filled_date`, `could_not_operate`, etc.) — obrigatório salvar sempre que vier',
      },

      pix_qr_code: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Payload texto “copia e cola” do PIX quando devolvido no checkout.',
      },
      pix_qr_code_base64: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Imagem/Base64 oficial do QR (quando o MP disponibiliza).',
      },
      pix_expires_at: { type: DataTypes.DATE, allowNull: true },

      card_last_four_digits: { type: DataTypes.STRING(8), allowNull: true },
      installments: { type: DataTypes.INTEGER, allowNull: true },
      chargeback_status: {
        type: DataTypes.STRING(64),
        allowNull: true,
        comment:
          'Status consolidado vindos do Seller (`payments` chargebacks/disputas) ou campos paralelos quando existirem',
      },

      mp_fee_amount: {
        type: DataTypes.DECIMAL(14, 4),
        allowNull: true,
        comment: 'Soma das taxas do MP já convertida para número decimal brasileiro (string → DECIMAL).',
      },
      mp_net_received_amount: {
        type: DataTypes.DECIMAL(14, 4),
        allowNull: true,
        comment: 'Valor líquido creditado segundo o gateway (transaction_amount - fees quando aplicável).',
      },

      mp_nfe_status: {
        type: DataTypes.ENUM(...MP_NFE_STATUSES),
        allowNull: false,
        defaultValue: 'PENDING',
        comment: 'Orquestração automática NFS-e dentro do MP (webhooks/notifications).',
      },
      mp_nfe_url: {
        type: DataTypes.STRING(1024),
        allowNull: true,
        comment: 'Link público da nota emitida ou PDF oficial retornado pela integração MP.',
      },

      raw_webhook_payload: {
        type: DataTypes.JSONB,
        allowNull: true,
        comment:
          'Cofre obrigatório: mesclar payloads recebidos (array ou envelope versionado na camada de serviços) antes de atualizar outros campos.',
      },

      paid_at: { type: DataTypes.DATE, allowNull: true },
      refunded_at: { type: DataTypes.DATE, allowNull: true },
      refund_reason: { type: DataTypes.TEXT, allowNull: true },
      chargeback_opened_at: { type: DataTypes.DATE, allowNull: true },
      chargeback_reason_code: { type: DataTypes.STRING(64), allowNull: true },
      chargeback_notes: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      sequelize,
      modelName: 'PaymentOrder',
      tableName: 'payment_orders',
      paranoid: true,
      indexes: [
        {
          unique: true,
          name: 'payment_orders_external_ref_deleted_at_null_uidx',
          fields: ['external_reference'],
          where: { deleted_at: null },
        },
        {
          unique: true,
          name: 'payment_orders_idempotency_internal_deleted_null_uidx',
          fields: ['idempotency_key_internal'],
          where: sequelize.literal(
            '"deleted_at" IS NULL AND "idempotency_key_internal" IS NOT NULL'
          ),
        },
        { fields: ['client_id'] },
        { fields: ['status'] },
        { fields: ['mp_payment_id'] },
        { fields: ['mp_merchant_order_id'] },
      ],
    }
  );

  PaymentOrder.ORDER_STATUSES = ORDER_STATUSES;
  PaymentOrder.PAYMENT_METHODS = PAYMENT_METHODS;
  PaymentOrder.MP_NFE_STATUSES = MP_NFE_STATUSES;
  return PaymentOrder;
};
