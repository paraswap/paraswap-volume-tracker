import BigNumber from 'bignumber.js';
import { Event } from 'ethers';
import * as _ from 'lodash';
import * as pMemoize from 'p-memoize';
import * as QuickLRU from 'quick-lru';
import { CHAIN_ID_MAINNET } from '../../src/lib/constants';
import { SUBGRAPH_URL } from '../../src/lib/block-info';
import { thegraphClient } from './data-providers-clients';
import { assert } from 'console';

export const ONE_HOUR_SEC = 60 * 60;
const DAY_SEC_MSEC = 1000 * ONE_HOUR_SEC * 24;

export const ZERO_BN = new BigNumber(0);

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

async function fetchBlockTimestamp({
  chainId,
  blockNumber,
}: {
  chainId: number;
  blockNumber: number;
}): Promise<number> {
  const subgraphURL = SUBGRAPH_URL[chainId];
  const query = `query ($block: BigInt) {
      blocks(first: 1, where: {number: $block}) {
        number
        timestamp
      }
    }`;
  const variables = {
    block: blockNumber,
  };

  const {
    data: { data },
  } = await thegraphClient.post<{ data: { blocks: [{ timestamp: string }] } }>(
    subgraphURL,
    { query, variables },
  );

  const timestamp = +data.blocks[0].timestamp;

  assert(
    typeof timestamp === 'number' && !isNaN(timestamp) && timestamp > 0,
    `could not resolve timestamp for block ${blockNumber}`,
  );

  return timestamp;
}

export const fetchBlockTimestampCached = pMemoize(fetchBlockTimestamp, {
  cache: new QuickLRU({
    maxSize: 5000,
  }),
});

export async function fetchBlockTimestampForEvents(events: Event[]) {
  const blockNumbers = _.uniq(events.map(event => event.blockNumber));

  return Object.fromEntries(
    await Promise.all(
      blockNumbers.map(
        async blockNumber =>
          [
            blockNumber,
            await fetchBlockTimestampCached({
              blockNumber,
              chainId: CHAIN_ID_MAINNET,
            }),
          ] as const,
      ),
    ),
  );
}
