export type TimeSeriesItem = { timestamp: number; value: bigint };
export type TimeSeries = TimeSeriesItem[];

// @TODO: microopt turn on memoisation / dynamic programing
export function reduceTimeSeries(
  timestamp: number,
  initValue: bigint | undefined,
  series: TimeSeries | undefined,
  shouldSort = true,
) {
  let sum = initValue || BigInt(0);

  if (!series || !series.length) return sum;

  // on first visit sorting will cost, on subsequent visits sorting should be fast
  if (shouldSort) series.sort(timeseriesComparator);

  for (let i = 0; i < series.length; i++) {
    if (timestamp < series[i].timestamp) break;

    sum = sum + series[i].value;
  }

  return sum;
}

export function timeseriesComparator(a: TimeSeriesItem, b: TimeSeriesItem) {
  if (a.timestamp < b.timestamp) return -1;
  if (a.timestamp > b.timestamp) return 1;
  return 0;
}

export function serialiseTimeSeriesValues(timeseries: TimeSeries) {
  return timeseries.map(v => ({ ...v, value: v.value.toString() }));
}
