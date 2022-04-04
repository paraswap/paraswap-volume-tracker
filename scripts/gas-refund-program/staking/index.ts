import BigNumber from 'bignumber.js';
import { assert } from 'ts-essentials';
import { BlockInfo } from '../../../src/lib/block-info';
import { CHAIN_ID_MAINNET } from '../../../src/lib/constants';
import { GRP_MIN_STAKE } from '../../../src/lib/gas-refund';
import { StakedPSPByAddress } from '../types';
import { getSPSPStakes } from './spsp-stakes';
import { startOfHour } from 'date-fns';
import * as NodeCache from 'node-cache';
import _ from 'lodash';

// @TODO: fetch safety-module stakes
type GetPSPStakesOutput = Promise<StakedPSPByAddress | null>;

export const getPSPStakes = async (
  timestamp: number,
): Promise<StakedPSPByAddress | null> => {
  const blockNumber = await BlockInfo.getInstance(
    CHAIN_ID_MAINNET,
  ).getBlockAfterTimeStamp(timestamp);

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

const timeseriesStakesCache = new NodeCache({ useClones: false, stdTTL: 60 });

export const getPSPStakesHourly = (unixTimestamp: number) => {
  const startOfHourTimestampUnix =
    startOfHour(unixTimestamp * 1000).getTime() / 1000;

  if (timeseriesStakesCache.has(startOfHourTimestampUnix)) {
    return timeseriesStakesCache.get<GetPSPStakesOutput>(
      startOfHourTimestampUnix,
    );
  }

  const pspStakesPromise = getPSPStakes(startOfHourTimestampUnix);

  timeseriesStakesCache.set<GetPSPStakesOutput>(
    startOfHourTimestampUnix,
    pspStakesPromise,
  );

  return pspStakesPromise;
};
