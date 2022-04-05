import BigNumber from 'bignumber.js';
import { assert } from 'ts-essentials';
import { BlockInfo } from '../../../src/lib/block-info';
import { CHAIN_ID_MAINNET } from '../../../src/lib/constants';
import { GRP_MIN_STAKE } from '../../../src/lib/gas-refund';
import { StakedPSPByAddress } from '../types';
import { getSPSPStakes } from './spsp-stakes';
import { generateHourlyTimestamps } from '../utils';
import * as pMemoize from 'p-memoize';
import * as QuickLRU from 'quick-lru';
import * as pLimit from 'p-limit';

// prefering limiting calls to avoid touching blockInfo implem
const blockInfoLimit = pLimit(1);

// @TODO: fetch safety-module stakes
const getAllPSPStakes = async (
  timestamp: number,
): Promise<StakedPSPByAddress | null> => {
  const blockNumber = await blockInfoLimit(() =>
    BlockInfo.getInstance(CHAIN_ID_MAINNET).getBlockAfterTimeStamp(timestamp),
  );

  assert(blockNumber, 'blocknumber could be retrieved');

  const stakesByAddress = await getSPSPStakes({ blockNumber });

  if (!stakesByAddress) return null;

  const filteredStakesByAddress = Object.entries(
    stakesByAddress,
  ).reduce<StakedPSPByAddress>((acc, [address, stakes]) => {
    if (new BigNumber(stakes).lt(GRP_MIN_STAKE)) return acc;
    acc[address] = stakes;
    return acc;
  }, {});

  return filteredStakesByAddress;
};

const getAllPSPStakesCached = pMemoize(getAllPSPStakes, {
  cache: new QuickLRU({
    maxSize: 30,
  }),
});

export const getPSPStakesHourlyWithinInterval = async (
  startUnixTimestamp: number,
  endUnixTimestamp: number,
): Promise<{ [timestamp: number]: StakedPSPByAddress | null }> => {
  const hourlyUnixTimestamps = generateHourlyTimestamps(
    startUnixTimestamp,
    endUnixTimestamp,
  );

  return Object.fromEntries(
    await Promise.all(
      hourlyUnixTimestamps.map(
        async unixTimestamp =>
          [unixTimestamp, await getAllPSPStakesCached(unixTimestamp)] as const,
      ),
    ),
  );
};
