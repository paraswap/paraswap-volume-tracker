import Database from '../../src/database';
import { CHAIN_ID_MAINNET } from '../../src/lib/constants';
import { EpochInfo } from '../../src/lib/epoch-info';
import { GasRefundTransaction } from '../../src/models/GasRefundTransaction';

type Params = {
  dbTransactionNamespace?: string;
};

export async function init(options?: Params) {
  await Database.connectAndSync(options?.dbTransactionNamespace);
  const epochInfo = EpochInfo.getInstance(CHAIN_ID_MAINNET, true);
  await epochInfo.getEpochInfo();
}

export const SCRIPT_START_TIME_SEC = Math.round(Date.now() / 1000); // stable script start time to align stakes and transactions fetching time intervals
export const OFFSET_CALC_TIME = 5 * 60; // delay to ensure that all third parties providers are synced + protection against reorg

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

  return {
    startCalcTime: epochStartTime,
    endCalcTime: Math.min(
      SCRIPT_START_TIME_SEC - OFFSET_CALC_TIME,
      epochEndTime,
    ),
    isEpochEnded: SCRIPT_START_TIME_SEC >= epochEndTime + OFFSET_CALC_TIME,
  };
}

export const generateLockKeyForTxTable = (chainId: number) =>
  `${GasRefundTransaction.tableName}_${chainId}`;
