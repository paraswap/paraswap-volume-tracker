import '../../src/lib/log4js';
import * as dotenv from 'dotenv';
dotenv.config();
import { computeMerkleData } from './refund/merkle-tree';
import { fetchDailyPSPChainCurrencyRate } from './psp-chaincurrency-pricing';
import { computeAccumulatedTxFeesByAddress } from './transactions-indexing';
import Database from '../../src/database';

import { writeCompletedEpochData } from './persistance/db-persistance';

import { getPSPStakes } from './staking';
import { StakedPSPByAddress } from './types';
import { EpochInfo } from '../../src/lib/epoch-info';
import { CHAIN_ID_MAINNET } from '../../src/lib/constants';
import { assert } from 'ts-essentials';
import { GRP_SUPPORTED_CHAINS } from '../../src/lib/gas-refund';

const logger = global.LOGGER('GRP');

// @FIXME: should cap amount distributed to stakers to 30k
export async function calculateGasRefundForChain({
  chainId,
  epoch,
  stakes,
  epochStartTime,
  epochEndTime,
}: {
  chainId: number;
  epoch: number;
  stakes: StakedPSPByAddress;
  epochStartTime: number;
  epochEndTime: number;
}) {
  // retrieve daily psp/native currency rate for (epochStartTime, epochEndTime
  logger.info(
    `start fetching daily psp/native currency rate for chainId=${chainId}`,
  );
  const pspNativeCurrencyDailyRate = await fetchDailyPSPChainCurrencyRate({
    chainId,
    startTimestamp: epochStartTime,
    endTimestamp: epochEndTime,
  });

  // retrieve all tx beetween (start_epoch_timestamp, end_epoch_timestamp) +  compute progressively mapping(chainId => address => mapping(timestamp => accGasUsedPSP)) // address: txOrigin, timestamp: start of the day
  logger.info(`start computing accumulated tx fees for chainId=${chainId}`);

  const accTxFeesByAddress = await computeAccumulatedTxFeesByAddress({
    chainId,
    epoch,
    pspNativeCurrencyDailyRate,
    startTimestamp: epochStartTime,
    endTimestamp: epochEndTime,
    stakes,
  });

  if (Date.now() < epochEndTime * 1000) return; // skip other operations as epoch is not finished

  // combine data to form mapping(chainId => address => {totalStakes@debug, gasRefundPercent@debug, accGasUsedPSP@debug, refundAmount})  // amount = accGasUsedPSP * gasRefundPercent
  logger.info(`reduce gas refund by address for chainId=${chainId}`);

  // compute mapping(networkId => MerkleTree)
  logger.info(`compute merkleTree for chainId=${chainId}`);
  const claimables = Object.values(accTxFeesByAddress).map(t => ({
    address: t.address,
    amount: t.refundedAmountPSP,
  }));
  const merkleTree = await computeMerkleData(chainId, claimables, epoch);

  await writeCompletedEpochData(chainId, merkleTree, stakes);
}

async function resolveEpochStartEndTime(
  epoch: number,
): Promise<{ epochStartTime: number; epochEndTime: number }> {
  const epochInfo = EpochInfo.getInstance(CHAIN_ID_MAINNET, true);
  await epochInfo.getEpochDetails();
  const [epochStartTime, epochEndTime] = await Promise.all([
    epochInfo.getEpochStartCalcTime(epoch),
    epochInfo.getEpochEndCalcTime(epoch),
  ]);
  return { epochStartTime, epochEndTime };
}

async function start() {
  const epochNum = 8; // @TODO: automatise
  await Database.connectAndSync();

  const { epochStartTime, epochEndTime } = await resolveEpochStartEndTime(
    epochNum,
  );

  const stakes = await getPSPStakes(epochEndTime);

  assert(stakes, 'no stakers found at all');
  assert(epochStartTime, `could not resolve ${epochNum}th epoch start time`);
  assert(epochEndTime, `could not resolve ${epochNum}th epoch end time`);

  await Promise.all(
    GRP_SUPPORTED_CHAINS.map(chainId =>
      calculateGasRefundForChain({
        chainId,
        epoch: epochNum,
        stakes,
        epochStartTime,
        epochEndTime,
      }),
    ),
  );
}

start();
