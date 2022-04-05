import '../../src/lib/log4js';
import * as dotenv from 'dotenv';
dotenv.config();
import { computeGasRefundAllTxs } from './transactions-indexing';
import Database from '../../src/database';

import { merkleRootExists } from './persistance/db-persistance';

import { assert } from 'ts-essentials';
import {
  GasRefundGenesisEpoch,
  GRP_SUPPORTED_CHAINS,
} from '../../src/lib/gas-refund';
import { resolveEpochCalcTimeInterval } from './utils';

const logger = global.LOGGER('GRP');

async function startComputingGasRefundAllChains() {
  const epoch = Number(process.env.GRP_EPOCH) || GasRefundGenesisEpoch; // @TODO: automate

  assert(
    epoch >= GasRefundGenesisEpoch,
    'cannot compute refund data for epoch < genesis_epoch',
  );

  await Database.connectAndSync();

  const { startCalcTime, endCalcTime } = await resolveEpochCalcTimeInterval(
    epoch,
  );

  assert(startCalcTime, `could not resolve ${epoch}th epoch start time`);
  assert(endCalcTime, `could not resolve ${epoch}th epoch end time`);

  return Promise.allSettled(
    GRP_SUPPORTED_CHAINS.map(async chainId => {
      if (await merkleRootExists({ chainId, epoch }))
        throw new Error(
          `merkle root for chainId=${chainId} epoch=${epoch} already exists`,
        );

      return computeGasRefundAllTxs({
        chainId,
        epoch,
        startTimestamp: startCalcTime,
        endTimestamp: endCalcTime,
      });
    }),
  );
}

startComputingGasRefundAllChains()
  .then(ps => {
    const maybeOneRejected = ps.find(
      p => p.status === 'rejected',
    ) as PromiseRejectedResult;

    if (maybeOneRejected) {
      throw maybeOneRejected.reason;
    }

    process.exit(0);
  })
  .catch(err => {
    logger.error('startComputingGasRefundAllChains exited with error:', err);
    process.exit(1);
  });
