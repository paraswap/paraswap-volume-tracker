import BigNumber from 'bignumber.js';
import { assert } from 'ts-essentials';
import { BlockInfo } from '../../../src/lib/block-info';
import { CHAIN_ID_MAINNET } from '../../../src/lib/constants';
import { GRP_MIN_STAKE } from '../../../src/lib/gas-refund';
import { StakedPSPByAddress } from '../types';
import { getSPSPStakes } from './spsp-stakes';

// @TODO: fetch safety-module stakes
export const getPSPStakes = async (
  endCalcTime: number,
): Promise<StakedPSPByAddress | null> => {
  const blockNumber = await BlockInfo.getInstance(
    CHAIN_ID_MAINNET,
  ).getBlockAfterTimeStamp(endCalcTime);

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
