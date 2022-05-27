import BigNumber from 'bignumber.js';
import { Event } from 'ethers';
import * as _ from 'lodash';
import { CHAIN_ID_MAINNET } from '../../src/lib/constants';
import { SUBGRAPH_URL } from '../../src/lib/block-info';
import { thegraphClient } from '../../src/lib/utils/data-providers-clients';
import { assert } from 'console';
import { sliceCalls } from '../../src/lib/utils/helpers';

export const ONE_HOUR_SEC = 60 * 60;
const DAY_SEC_MSEC = 1000 * ONE_HOUR_SEC * 24;

export const ZERO_BN = new BigNumber(0);

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

// @testOnly
export const BNReplacer = (key: string, value: any): any => {
  if (!value) return value;
  if (value instanceof BigNumber) {
    return value.toFixed();
  }
  if (Array.isArray(value)) {
    return value.map(v => BNReplacer('', v));
  }
  if (typeof value === 'object') {
    const list = Object.entries(value).map(([k, v]) => [k, BNReplacer(k, v)]);

    return Object.fromEntries(list);
  }
  return value;
};

export const xor = (a: any, b: any): boolean => !!(Number(!!a) ^ Number(!!b));

export const xnor = (a: any, b: any): boolean => !xor(a, b);
