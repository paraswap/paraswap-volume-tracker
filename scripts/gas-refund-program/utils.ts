import BigNumber from 'bignumber.js';
import { Event } from 'ethers';
import * as _ from 'lodash';
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

export type QueryPaginatedDataParams = {
  skip: number;
  pageNumber: number;
  pageSize: number;
};
export async function queryPaginatedData<T>(
  query: ({
    skip,
    pageNumber,
    pageSize,
  }: QueryPaginatedDataParams) => Promise<T[]>,
  pageSize: number,
): Promise<T[]> {
  let items: T[] = [];
  let skip = 0;
  let pageNumber = 0;

  while (true) {
    const _items = await query({ skip, pageNumber, pageSize });
    items = items.concat(_items);
    if (_items.length < pageSize) {
      break;
    }
    skip = skip + pageSize;
    pageNumber++;
  }

  return items;
}

export const startOfHourSec = (unixTimestamp: number) => {
  return Math.floor(unixTimestamp / ONE_HOUR_SEC) * ONE_HOUR_SEC;
};

export const startOfDayMilliSec = (timestamp: number) => {
  return Math.floor(timestamp / DAY_SEC_MSEC) * DAY_SEC_MSEC;
};

async function fetchBlocksTimestamps({
  chainId,
  blockNumbers: _blockNumbers,
}: {
  chainId: number;
  blockNumbers: number[];
}): Promise<{ [blockNumber: number]: number }> {
  const blockNumbers = _.uniq(_blockNumbers);

  const sliceLength = 100;

  const execute = async (
    blockNumberSliced: number[],
  ): Promise<[{ number: string; timestamp: string }]> => {
    const subgraphURL = SUBGRAPH_URL[chainId];
    const query = `query ($sliceLength: Int, $blocks: [BigInt!]!) {
      blocks(first: $sliceLength, where: {number_in: $blocks}) {
        number
        timestamp
      }
    }`;
    const variables = {
      sliceLength,
      blocks: blockNumberSliced,
    };

    const {
      data: { data },
    } = await thegraphClient.post<{
      data: { blocks: [{ number: string; timestamp: string }] };
    }>(subgraphURL, { query, variables });

    assert(
      data.blocks.length === blockNumberSliced.length,
      `didn't get all the blocks`,
    );

    return data.blocks;
  };

  const allResults = (
    await Promise.all(
      sliceCalls({ inputArray: blockNumbers, execute, sliceLength }),
    )
  ).flat();

  return Object.fromEntries(
    allResults.map(({ number, timestamp }) => [number, +timestamp]),
  );
}

export const fetchBlockTimestampForEvents = async (
  events: Event[],
): Promise<{ [blockNumber: string]: number }> =>
  fetchBlocksTimestamps({
    chainId: CHAIN_ID_MAINNET,
    blockNumbers: events.map(event => event.blockNumber),
  });
