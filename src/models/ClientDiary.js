const { Model, DataTypes } = require('sequelize');

class ClientDiary extends Model {}

module.exports = (sequelize) => {
  ClientDiary.init(
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
      content: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      /** Coluna SQL `date`. */
      calendar_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        field: 'date',
      },
    },
    {
      sequelize,
      modelName: 'ClientDiary',
      tableName: 'client_diaries',
      paranoid: true,
      underscored: true,
      indexes: [
        { fields: ['client_id'] },
        { name: 'client_diaries_date_idx', fields: ['calendar_date'] },
      ],
    }
  );

  return ClientDiary;
};
