'use strict';

/** @type {import('sequelize-cli').Migration} */

module.exports = {
  async up(queryInterface, Sequelize) {
    // queryInterface.
    await queryInterface.addColumn(
      'GasRefundTransactionStakeSnapshots',
      'staker',
      Sequelize.STRING(42),
    );

    // Drop the 'txChain_txHash_stakeChain' key if it exists -- the old constraint, without staker column.
    // the new one will be auto-created by modle
    await queryInterface.removeIndex(
      'GasRefundTransactionStakeSnapshots',
      'txChain_txHash_stakeChain',
    );
  },

  async down(queryInterface) {
    queryInterface.removeColumn('GasRefundTransactionStakeSnapshots', 'staker');
    await queryInterface.removeIndex(
      'GasRefundTransactionStakeSnapshots',
      'txChain_txHash_staker_stakeChain',
    );
  },
};
