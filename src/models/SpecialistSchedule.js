const { Model, DataTypes } = require('sequelize');

class SpecialistSchedule extends Model {}

/**
 * Agenda semanal editável por especialista.
 * Interpretação dos TIME: sempre no fuso definido em `specialists.timezone` (IANA), ex.: America/Sao_Paulo.
 * Vários blocos no mesmo `day_of_week` são válidos (ex.: manhã e tarde).
 */
module.exports = (sequelize) => {
  SpecialistSchedule.init(
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
      /** 0 = Domingo … 6 = Sábado (JS Date.getDay) */
      day_of_week: {
        type: DataTypes.SMALLINT,
        allowNull: false,
      },
      start_time: {
        type: DataTypes.TIME,
        allowNull: false,
      },
      end_time: {
        type: DataTypes.TIME,
        allowNull: false,
      },
      is_active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
    },
    {
      sequelize,
      modelName: 'SpecialistSchedule',
      tableName: 'specialist_schedules',
      paranoid: false,
      indexes: [
        {
          fields: ['specialist_id', 'day_of_week'],
          name: 'specialist_schedules_specialist_day_idx',
        },
        {
          fields: ['specialist_id'],
          where: { is_active: true },
          name: 'specialist_schedules_specialist_active_idx',
        },
      ],
    }
  );

  return SpecialistSchedule;
};
