const { Model, DataTypes } = require('sequelize');

/** Mesmos valores lógicos que `specialists.status` (ONLINE | EM_ATENDIMENTO | AUSENTE | OFFLINE). */
const STATUS_VALUES = ['ONLINE', 'EM_ATENDIMENTO', 'AUSENTE', 'OFFLINE'];

class SpecialistStatusLog extends Model {}

/**
 * Histórico imutável de transições de status operacional para disputas («horas online», SLA, auditoria).
 * Inserções devem ser feitas pelo serviço sempre que `specialists.status` for atualizado na app.
 */
module.exports = (sequelize) => {
  SpecialistStatusLog.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      specialist_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      /** Valor antes da mudança; NULL na primeira marcação ou após migrações sem estado anterior */
      previous_status: {
        type: DataTypes.STRING(24),
        allowNull: true,
      },
      new_status: {
        type: DataTypes.STRING(24),
        allowNull: false,
      },
      changed_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      sequelize,
      modelName: 'SpecialistStatusLog',
      tableName: 'specialist_status_logs',
      paranoid: false,
      timestamps: false,
      indexes: [{ fields: ['specialist_id', 'changed_at'] }],
    }
  );

  SpecialistStatusLog.STATUS_VALUES = STATUS_VALUES;
  return SpecialistStatusLog;
};
