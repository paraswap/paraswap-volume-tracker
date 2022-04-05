import { CHAIN_ID_MAINNET } from '../../src/lib/constants';
import { EpochInfo } from '../../src/lib/epoch-info';
import * as _ from 'lodash';

export const ONE_HOUR_SEC = 60 * 60;
const DAY_SEC = 1000 * 60 * 60 * 24;

interface SliceCallsInput<T, U> {
  inputArray: T[];
  execute: (inputSlice: T[], sliceIndex: number) => U;
  sliceLength: number;
}

export function sliceCalls<T, U>({
  inputArray,
  execute,
  sliceLength,
}: SliceCallsInput<T, U>): [U, ...U[]] {
  if (sliceLength >= inputArray.length) return [execute(inputArray, 0)];
  const results: U[] = [];

  for (
    let i = 0, sliceIndex = 0;
    i < inputArray.length;
    i += sliceLength, ++sliceIndex
  ) {
    const inputSlice = inputArray.slice(i, i + sliceLength);
    const resultOfSlice = execute(inputSlice, sliceIndex);
    results.push(resultOfSlice);
  }

  return results as [U, ...U[]];
}

const OFFSET_CALC_TIME = 5 * 60; // 5min delay to ensure that all third parties providers are synced

export async function resolveEpochCalcTimeInterval(epoch: number): Promise<{
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
    isEpochEnded: nowUnixTime > epochEndTime + OFFSET_CALC_TIME,
  };
}

export const startOfHourSec = (unixTimestamp: number) => {
  return Math.floor(unixTimestamp / ONE_HOUR_SEC) * ONE_HOUR_SEC;
};

export const startOfDayMilliSec = (timestamp: number) => {
  return Math.floor(timestamp / DAY_SEC) * DAY_SEC;
};

export const generateHourlyTimestamps = (
  startUnixTimestamp: number,
  endUnixTimestamp: number,
) => {
  const startOfHourTimestampUnix = startOfHourSec(startUnixTimestamp);
  const endOfHourTimestampUnix = startOfHourSec(endUnixTimestamp);
  const hoursInBetween = Math.floor(
    (endOfHourTimestampUnix - startOfHourTimestampUnix) / ONE_HOUR_SEC,
  );
  const hourlyTimestamps = _.range(0, hoursInBetween + 1).map(
    i => startOfHourTimestampUnix + i * ONE_HOUR_SEC,
  );

  return hourlyTimestamps;
};
