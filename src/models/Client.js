const { Model, DataTypes } = require('sequelize');

class Client extends Model {}

module.exports = (sequelize) => {
  Client.init(
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
      /** Nome completo legal / preferencial do cliente — fonte única para `nome_id`. */
      nome_completo: {
        type: DataTypes.STRING(160),
        allowNull: true,
      },
      /** Nome resumido visível público conforme política Nice (`business.config.NAME_ID_GENERATION_LOGIC`). */
      nome_id: {
        type: DataTypes.STRING(160),
        allowNull: true,
      },
      /** Legado compatível até migrações de API consumirem só `nome_completo`. */
      nome: { type: DataTypes.STRING(160), allowNull: true },
      /** Apresentação informal (ex.: "Mari"). Distinto do `nome_id`. */
      apelido: { type: DataTypes.STRING(80), allowNull: true },
      tratar_por: { type: DataTypes.STRING(120), allowNull: true },
      data_nascimento: { type: DataTypes.DATEONLY, allowNull: true },
      cpf: { type: DataTypes.STRING(14), allowNull: true },
      cep: { type: DataTypes.STRING(16), allowNull: true },
      endereco_completo: { type: DataTypes.STRING(512), allowNull: true },
      complemento: { type: DataTypes.STRING(160), allowNull: true },
      cidade: { type: DataTypes.STRING(120), allowNull: true },
      estado: { type: DataTypes.STRING(2), allowNull: true },
      pricing_level_id: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      manual_price_override: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'Gestora fixou tratamento/manual de preço fora da tabela dinâmica',
      },
      manual_price_notes: { type: DataTypes.TEXT, allowNull: true },
      nickname: { type: DataTypes.STRING(80), allowNull: true },
      internal_notes: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Notas internas da Gestora/atendimento — não expor ao app cliente',
      },
      first_completed_session_at: { type: DataTypes.DATE, allowNull: true },
      loyalty_tier_cached: {
        type: DataTypes.STRING(64),
        allowNull: true,
        comment: 'Cache opcional derivado do histórico (exibir no app)',
      },
    },
    {
      sequelize,
      modelName: 'Client',
      tableName: 'clients',
      paranoid: true,
      hooks: {
        beforeValidate: (inst) => {
          const business = require('../config/business.config');
          const { deriveNomeIdFromNomeCompleto } = require('../utils/name.util');
          const full =
            `${inst.get('nome_completo') ?? ''}`.trim() || `${inst.get('nome') ?? ''}`.trim();
          if (!full) {
            return;
          }
          inst.set(
            'nome_id',
            deriveNomeIdFromNomeCompleto(full, business.NAME_ID_GENERATION_LOGIC)
          );
        },
      },
      indexes: [
        { fields: ['pricing_level_id'] },
        {
          unique: true,
          name: 'clients_user_deleted_at_null_uidx',
          fields: ['user_id'],
          where: { deleted_at: null },
        },
        {
          unique: true,
          name: 'clients_cpf_deleted_at_null_uidx',
          fields: ['cpf'],
          where: sequelize.literal('"deleted_at" IS NULL AND "cpf" IS NOT NULL'),
        },
      ],
    }
  );

  return Client;
};
