import { assert } from 'ts-essentials';
import { CHAIN_ID_MAINNET } from '../../src/lib/constants';
import { EpochInfo } from '../../src/lib/epoch-info';
import { OFFSET_CALC_TIME, SCRIPT_START_TIME_SEC } from './common';

export async function loadEpochMetaData() {
  const epochInfo = EpochInfo.getInstance(CHAIN_ID_MAINNET, true);
  await epochInfo.getEpochInfo();
}

export async function resolveEpochCalcTimeInterval(epoch: number): Promise<{
  startCalcTime: number;
  endCalcTime: number;
  isEpochEnded: boolean;
}> {
  const epochInfo = EpochInfo.getInstance(CHAIN_ID_MAINNET, true);
  const [epochStartTime, epochDuration] = await Promise.all([
    epochInfo.getEpochStartCalcTime(epoch),
    epochInfo.getEpochDuration(),
  ]);
  const epochEndTime = epochStartTime + epochDuration; // safer than getEpochEndCalcTime as it fails for current epoch
  const isEpochEnded = SCRIPT_START_TIME_SEC >= epochEndTime + OFFSET_CALC_TIME;
  const endCalcTime = Math.min(
    SCRIPT_START_TIME_SEC - OFFSET_CALC_TIME,
    epochEndTime,
  );

  return {
    startCalcTime: epochStartTime,
    endCalcTime,
    isEpochEnded,
  };
}

export function getCurrentEpoch() {
  const currentEpoch = EpochInfo.getInstance(
    CHAIN_ID_MAINNET,
    true,
  ).currentEpoch;

  assert(currentEpoch, 'currentEpoch should defined');

  return currentEpoch;
}

export async function getEpochStartCalcTime(epoch: number) {
  const epochInfo = EpochInfo.getInstance(CHAIN_ID_MAINNET, true);

  return epochInfo.getEpochStartCalcTime(epoch);
}
