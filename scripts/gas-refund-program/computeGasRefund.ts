import '../../src/lib/log4js';
import * as dotenv from 'dotenv';
dotenv.config();
import { fetchDailyPSPChainCurrencyRate } from './psp-chaincurrency-pricing';
import { computeGasRefundAllTxs } from './transactions-indexing';
import Database from '../../src/database';

import { merkleRootExists } from './persistance/db-persistance';

import { getPSPStakes } from './staking';
import { StakedPSPByAddress } from './types';
import { assert } from 'ts-essentials';
import { GRP_SUPPORTED_CHAINS } from '../../src/lib/gas-refund';
import { resolveEpochCalcTimeInterval } from './utils';

const logger = global.LOGGER('GRP');

// @FIXME: should cap amount distributed to stakers to 30k
export async function fetchPSPRatesAndComputeGasRefundForChain({
  chainId,
  epoch,
  stakes,
  startCalcTime,
  endCalcTime,
}: {
  chainId: number;
  epoch: number;
  stakes: StakedPSPByAddress;
  startCalcTime: number;
  endCalcTime: number;
}) {
  if (await merkleRootExists({ chainId, epoch }))
    return logger.info(
      `merkle root for chainId=${chainId} epoch=${epoch} already exists`,
    );

  // retrieve daily psp/native currency rate for (startCalcTime, endCalcTime)
  logger.info(
    `start fetching daily psp/native currency rate for chainId=${chainId}`,
  );
  const pspNativeCurrencyDailyRate = await fetchDailyPSPChainCurrencyRate({
    chainId,
    startTimestamp: startCalcTime,
    endTimestamp: endCalcTime,
  });

  // retrieve all tx beetween (start_epoch_timestamp, end_epoch_timestamp) +  compute progressively mapping(chainId => address => mapping(timestamp => accGasUsedPSP)) // address: txOrigin, timestamp: start of the day
  logger.info(
    `start indexing transaction and accumulate tx fees and refund for chainId=${chainId}`,
  );

  await computeGasRefundAllTxs({
    chainId,
    epoch,
    pspNativeCurrencyDailyRate,
    startTimestamp: startCalcTime,
    endTimestamp: endCalcTime,
    stakes,
  });
}

async function startComputingGasRefundAllChains() {
  const epoch = Number(process.env.GRP_EPOCH) || 8; // @TODO: automate
  await Database.connectAndSync();

  const { startCalcTime, endCalcTime } = await resolveEpochCalcTimeInterval(
    epoch,
  );

  const stakes = await getPSPStakes(endCalcTime);

  assert(stakes, 'no stakers found at all');
  assert(startCalcTime, `could not resolve ${epoch}th epoch start time`);
  assert(endCalcTime, `could not resolve ${epoch}th epoch end time`);

  await Promise.all(
    GRP_SUPPORTED_CHAINS.map(chainId =>
      fetchPSPRatesAndComputeGasRefundForChain({
        chainId,
        epoch,
        stakes,
        startCalcTime,
        endCalcTime,
      }),
    ),
  );
}

startComputingGasRefundAllChains()
  .then(() => process.exit(0))
  .catch(err => {
    logger.error('startComputingGasRefundAllChains exited with error:', err);
    process.exit(1);
  });
