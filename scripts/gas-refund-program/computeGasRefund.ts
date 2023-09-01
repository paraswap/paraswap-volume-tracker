import * as dotenv from 'dotenv';
dotenv.config();

import '../../src/lib/log4js';
import Database from '../../src/database';
import StakesTracker from './staking/stakes-tracker';
import { validateTransactions } from './transactions-validation/validateTransactions';
import { fetchRefundableTransactionsAllChains } from './transactions-indexing/fetchRefundableTransactionsAllChains';
import { loadEpochMetaData } from '../../src/lib/gas-refund/epoch-helpers';

const logger = global.LOGGER('GRP');

/**
 * @description This function is meant to calculate the gas refund amount for all the users that are eligible for the
 * gas refund program.
 * It will perform the following steps sequentially:
 * 1) For each allowed staking chain it will load data for: sePSP1, sePSP2, BPT token connected to the chain specific LP and
 * the claimableSePSP1. ref: loadHistoricalStakes()
 * 2) Will fetch all the refundable trading transactions for all the chains and then compute the refunded amounts based
 * on total stakes across staking chain ids. ref: fetchRefundableTransactionsAllChains()
 * 3) Will perform a series of validations and filtering across the fetched transactions. ref: validateTransactions()
 * */
async function startComputingGasRefundAllChains() {
  await Database.connectAndSync('gas-refund-computation');
  await loadEpochMetaData();

  return Database.sequelize.transaction(async () => {
    await StakesTracker.getInstance().loadHistoricalStakes();

    await fetchRefundableTransactionsAllChains();

    await validateTransactions();
  });
}

startComputingGasRefundAllChains()
  .then(() => {
    process.exit(0);
  })
  .catch(err => {
    logger.error('startComputingGasRefundAllChains exited with error:', err);
    process.exit(1);
  });
