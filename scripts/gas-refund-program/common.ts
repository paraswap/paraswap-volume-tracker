import Database from '../../src/database';
import { CHAIN_ID_MAINNET } from '../../src/lib/constants';
import { EpochInfo } from '../../src/lib/epoch-info';

type Params = {
  epochPolling?: boolean;
  dbTransactionNamespace?: string;
};

export async function init(options?: Params) {
  await Database.connectAndSync(options?.dbTransactionNamespace);
  const epochInfo = EpochInfo.getInstance(CHAIN_ID_MAINNET, true);
  await epochInfo.getEpochInfo();
  if (options?.epochPolling) epochInfo.startEpochInfoPolling();
}

const OFFSET_CALC_TIME = 5 * 60; // delay to ensure that all third parties providers are synced

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
