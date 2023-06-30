
import * as dotenv from 'dotenv';
dotenv.config();

import '../../src/lib/log4js';
import Database from '../../src/database';
import StakesTracker from './staking/stakes-tracker';
import {validateTransactions} from './transactions-validation/validateTransactions';
import {fetchRefundableTransactionsByChain} from './transactions-indexing/fetchRefundableTransactionsByChains';
import {loadEpochMetaData} from '../../src/lib/gas-refund/epoch-helpers';
import {STAKING_CHAIN_IDS} from "../../src/lib/constants";


const logger = global.LOGGER('GRP');

async function startComputingGasRefundAllChains() {
  await Database.connectAndSync('gas-refund-computation');
  await loadEpochMetaData();

  return Database.sequelize.transaction(async () => {

    await Promise.all(STAKING_CHAIN_IDS.map(computeGasRefundForChain))

    await validateTransactions();
  });
}

async function computeGasRefundForChain(chainId: number) {
  await StakesTracker.getInstance(chainId).loadHistoricalStakes();
  await fetchRefundableTransactionsByChain(chainId);
}

startComputingGasRefundAllChains()
  .then(() => {
    process.exit(0);
  })
  .catch(err => {
    logger.error('startComputingGasRefundAllChains exited with error:', err);
    process.exit(1);
  });
