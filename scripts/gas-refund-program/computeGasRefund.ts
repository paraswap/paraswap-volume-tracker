import '../../src/lib/log4js';
import * as dotenv from 'dotenv';
dotenv.config();
//import { acquireLock, releaseLock } from '../../src/lib/lock-utils.ts.old';
import Database from '../../src/database';
import StakesTracker from './staking/stakes-tracker';
import { validateTransactions } from './transactions-validation/validateTransactions';
import { fetchRefundableTransactionsAllChains } from './transactions-indexing/fetchRefundableTransactionsAllChains';
import { GasRefundTransaction } from '../../src/models/GasRefundTransaction';
import { loadEpochMetaData } from '../../src/lib/gas-refund/epoch-helpers';

const logger = global.LOGGER('GRP');

async function startComputingGasRefundAllChains() {
  await Database.connectAndSync('gas-refund-computation');
  await loadEpochMetaData();

  return Database.sequelize.transaction(async () => {
    //await acquireLock(GasRefundTransaction.tableName);

    await StakesTracker.getInstance().loadHistoricalStakes();

    await fetchRefundableTransactionsAllChains();

    await validateTransactions();

    //await releaseLock(GasRefundTransaction.tableName);
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
