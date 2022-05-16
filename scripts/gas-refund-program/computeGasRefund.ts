import '../../src/lib/log4js';
import * as dotenv from 'dotenv';
dotenv.config();
import { init } from './common';
import { acquireLock, releaseLock } from '../../src/lib/lock-utils';
import Database from '../../src/database';
import StakesTracker from './staking/stakes-tracker';
import { GRPBudgetGuardian } from './transactions-validation/GRPBudgetGuardian';
import { validateTransactions } from './transactions-validation/validateTransactions';
import { fetchRefundableTransactionsAllChains } from './transactions-indexing/fetchRefundableTransactionsAllChains';
import { GasRefundTransaction } from '../../src/models/GasRefundTransaction';

const logger = global.LOGGER('GRP');

async function startComputingGasRefundAllChains() {
  await init({
    dbTransactionNamespace: 'gas-refund-computation',
  });

  return Database.sequelize.transaction(async () => {
    await acquireLock(GasRefundTransaction.tableName);

    await GRPBudgetGuardian.getInstance().loadStateFromDB();
    GRPBudgetGuardian.getInstance().assertMaxPSPGlobalBudgetNotReached();

    await StakesTracker.getInstance().loadHistoricalStakes();

    await fetchRefundableTransactionsAllChains();

    await validateTransactions();

    await releaseLock(GasRefundTransaction.tableName);
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
