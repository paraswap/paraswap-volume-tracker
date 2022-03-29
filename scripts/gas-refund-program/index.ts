import '../../src/lib/log4js';
import * as dotenv from 'dotenv';
dotenv.config();
import { computeMerkleData } from './refund/merkle-tree';
import { fetchDailyPSPChainCurrencyRate } from './psp-chaincurrency-pricing';
import { computeAccumulatedTxFeesByAddress } from './transactions-indexing';
import Database from '../../src/database';

import {
  merkleRootExists,
  writeCompletedEpochData,
} from './persistance/db-persistance';

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
  startCalcTime,
  endCalcTime,
  isEpochEnded,
}: {
  chainId: number;
  epoch: number;
  stakes: StakedPSPByAddress;
  startCalcTime: number;
  endCalcTime: number;
  isEpochEnded: boolean;
}) {
  if (await merkleRootExists({ chainId, epoch }))
    return logger.info(
      `merkle root for chainId=${chainId} epoch=${epoch} already exists`,
    );

  // retrieve daily psp/native currency rate for (startCalcTime, endCalcTime
  logger.info(
    `start fetching daily psp/native currency rate for chainId=${chainId}`,
  );
  const pspNativeCurrencyDailyRate = await fetchDailyPSPChainCurrencyRate({
    chainId,
    startTimestamp: startCalcTime,
    endTimestamp: endCalcTime,
  });

  // retrieve all tx beetween (start_epoch_timestamp, end_epoch_timestamp) +  compute progressively mapping(chainId => address => mapping(timestamp => accGasUsedPSP)) // address: txOrigin, timestamp: start of the day
  logger.info(`start computing accumulated tx fees for chainId=${chainId}`);

  const accTxFeesByAddress = await computeAccumulatedTxFeesByAddress({
    chainId,
    epoch,
    pspNativeCurrencyDailyRate,
    startTimestamp: startCalcTime,
    endTimestamp: endCalcTime,
    stakes,
  });

  if (!isEpochEnded) return; // skip other operations as epoch is not finished

  // compute mapping(networkId => MerkleTree)
  logger.info(`compute merkleTree for chainId=${chainId}`);
  const claimables = Object.values(accTxFeesByAddress).map(t => ({
    address: t.address,
    amount: t.refundedAmountPSP,
  }));
  const merkleTree = await computeMerkleData(chainId, claimables, epoch);

  await writeCompletedEpochData(chainId, merkleTree, stakes);
}

const OFFSET_CALC_TIME = 5 * 60; // 5min delay to ensure that all third parties providers are synced

async function resolveCalcTimeInterval(epoch: number): Promise<{
  startCalcTime: number;
  endCalcTime: number;
  isEpochEnded: boolean;
}> {
  const epochInfo = EpochInfo.getInstance(CHAIN_ID_MAINNET, true);
  await epochInfo.getEpochDetails();
  const [epochStartTime, epochDuration] = await Promise.all([
    epochInfo.getEpochStartCalcTime(epoch),
    epochInfo.getEpochDuration(),
  ]);
  const epochEndTime = epochStartTime + epochDuration; // safer than getEpochEndCalcTime as it fails for current epoch

  const nowUnixTime = Math.round(Date.now() / 1000);

  return {
    startCalcTime: epochStartTime,
    endCalcTime: Math.min(nowUnixTime - OFFSET_CALC_TIME, epochEndTime),
    isEpochEnded: nowUnixTime > epochEndTime,
  };
}

async function start() {
  const epochNum = 8; // @TODO: automatise
  await Database.connectAndSync();

  const { startCalcTime, endCalcTime, isEpochEnded } =
    await resolveCalcTimeInterval(epochNum);

  const stakes = await getPSPStakes(endCalcTime);

  assert(stakes, 'no stakers found at all');
  assert(startCalcTime, `could not resolve ${epochNum}th epoch start time`);
  assert(endCalcTime, `could not resolve ${epochNum}th epoch end time`);

  await Promise.all(
    GRP_SUPPORTED_CHAINS.map(chainId =>
      calculateGasRefundForChain({
        chainId,
        epoch: epochNum,
        stakes,
        startCalcTime,
        endCalcTime,
        isEpochEnded,
      }),
    ),
  );
}

start();
