import Database from '../../src/database';
import { CHAIN_ID_MAINNET } from '../../src/lib/constants';
import { EpochInfo } from '../../src/lib/epoch-info';
import { ONE_HOUR_SEC } from './utils';

type Params = {
  epochPooling?: boolean;
};

export async function init(options?: Params) {
  await Database.connectAndSync();
  const epochInfo = EpochInfo.getInstance(CHAIN_ID_MAINNET, true);
  await epochInfo.getEpochInfo();
  if (options?.epochPooling) epochInfo.startEpochInfoPolling();
}

const OFFSET_CALC_TIME = ONE_HOUR_SEC; // delay to ensure that all third parties providers are synced + algo needds to retrieve stakes before/after 1h

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

  const nowSec = Math.round(Date.now() / 1000);

  return {
    startCalcTime: epochStartTime,
    endCalcTime: Math.min(nowSec - OFFSET_CALC_TIME, epochEndTime),
    isEpochEnded: nowSec > epochEndTime + OFFSET_CALC_TIME,
  };
}