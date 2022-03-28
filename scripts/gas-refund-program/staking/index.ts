import BigNumber from 'bignumber.js';
import { BlockInfo } from '../../../src/lib/block-info';
import { CHAIN_ID_MAINNET } from '../../../src/lib/constants';
import { GRP_MIN_STAKE } from '../../../src/lib/gas-refund';
import { StakedPSPByAddress } from '../types';
import { getSPSPStakes } from './spsp-stakes';

// @TODO: fetch safety-module stakes
export const getPSPStakes = async (
  epochEndTime: number,
): Promise<StakedPSPByAddress | null> => {
  const blockNumber =
    Date.now() > epochEndTime * 1000
      ? (await BlockInfo.getInstance(CHAIN_ID_MAINNET).getBlockAfterTimeStamp(
          epochEndTime,
        )) || undefined
      : undefined;

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
