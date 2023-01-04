import Database from '../../src/database';
import { CHAIN_ID_MAINNET } from '../../src/lib/constants';
import { EpochInfo } from '../../src/lib/epoch-info';
import { GasRefundTransaction } from '../../src/models/GasRefundTransaction';

type Params = {
  dbTransactionNamespace?: string;
};

const logger = global.LOGGER('GRP');

export async function init(options?: Params) {
  logger.info('connect to db');
  await Database.connectAndSync(options?.dbTransactionNamespace);
  logger.info('successfully connected to db');
  const epochInfo = EpochInfo.getInstance(CHAIN_ID_MAINNET, true);
  try {
    await epochInfo.getEpochInfo();
    logger.info('successful got into');
  } catch (e) {
    logger.error('issue with getEpochInfo', e);
  }
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
