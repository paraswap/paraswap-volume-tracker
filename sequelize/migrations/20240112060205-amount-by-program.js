'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    return queryInterface.addColumn(
      'GasRefundParticipations',
      'amountsByProgram',
      Sequelize.JSONB,
    );
  },

  async down(queryInterface) {
    queryInterface.removeColumn('GasRefundParticipations', 'amountsByProgram');
  },
};
