import BigNumber from 'bignumber.js';
import { ZERO_BN } from './utils';

export type TimeSeriesItem = { timestamp: number; value: BigNumber };
export type TimeSeries = TimeSeriesItem[];

// @TODO: microopt turn on memoisation / dynamic programing
export function reduceTimeSeries(
  timestamp: number,
  initValue: BigNumber | undefined,
  series: TimeSeries | undefined,
  shouldSort = true,
) {
  let sum = initValue || ZERO_BN;

  if (!series || !series.length) return sum;

  // on first visit sorting will cost, on subsequent visits sorting should be fast
  if (shouldSort) series.sort(timeseriesComparator);

  for (let i = 0; i < series.length; i++) {
    if (timestamp < series[i].timestamp) break;

    sum = sum.plus(series[i].value);
  }

  return sum;
}

export function timeseriesComparator(a: TimeSeriesItem, b: TimeSeriesItem) {
  if (a.timestamp < b.timestamp) return -1;
  if (a.timestamp > b.timestamp) return 1;
  return 0;
}
