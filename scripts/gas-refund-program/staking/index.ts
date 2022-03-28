import BigNumber from 'bignumber.js';
import { GRP_MIN_STAKE } from '../../../src/lib/gas-refund';
import { StakedPSPByAddress } from '../types';
import { getSPSPStakes } from './spsp-stakes';

// @TODO: fetch safety-module stakes
export const getPSPStakes = async (): Promise<StakedPSPByAddress | null> => {
  const stakesByAddress = await getSPSPStakes();

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
