import BigNumber from 'bignumber.js';
import * as _ from 'lodash';
import * as pLimit from 'p-limit';

export const ONE_HOUR_SEC = 60 * 60;
const DAY_SEC_MSEC = 1000 * ONE_HOUR_SEC * 24;

export const ZERO_BN = new BigNumber(0);

export const rpcCallConcurrencyLimited = pLimit(5);

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

export const startOfHourSec = (unixTimestamp: number) => {
  return Math.floor(unixTimestamp / ONE_HOUR_SEC) * ONE_HOUR_SEC;
};

export const startOfDayMilliSec = (timestamp: number) => {
  return Math.floor(timestamp / DAY_SEC_MSEC) * DAY_SEC_MSEC;
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
