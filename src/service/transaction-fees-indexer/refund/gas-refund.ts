import BigNumber from 'bignumber.js';
import { assert } from 'ts-essentials';
import { Claimable, StakedPSPByAddress, TxFeesByAddress } from '../types';

const logger = global.LOGGER('GRP:GAS_REFUND_COMPUTATION');

type GasRefundLevel = 'level_1' | 'level_2' | 'level_3' | 'level_4';

type GasRefundLevelsDef = {
  level: GasRefundLevel;
  minStakedAmount: BigNumber;
  refundPercent: number;
};

//                                                  psp decimals
const scale = (num: number) => new BigNumber(num).multipliedBy(1e18);

export const minStake = scale(500); // @FIXME: resolve min stake automatically

const gasRefundLevels: GasRefundLevelsDef[] = [
  {
    level: 'level_1' as const,
    minStakedAmount: minStake,
    refundPercent: 0.25,
  },
  {
    level: 'level_2' as const,
    minStakedAmount: scale(5_000),
    refundPercent: 0.5,
  },
  {
    level: 'level_3' as const,
    minStakedAmount: scale(50_000),
    refundPercent: 0.75,
  },
  {
    level: 'level_4' as const,
    minStakedAmount: scale(500_000),
    refundPercent: 1,
  },
].reverse(); // reverse for descending lookup

const getRefundPercent = (stakedAmount: string): number | undefined =>
  gasRefundLevels.find(({ minStakedAmount }) =>
    new BigNumber(stakedAmount).gte(minStakedAmount),
  )?.refundPercent;

export function computeGasRefundByAddress(
  accTxFeesByAddress: TxFeesByAddress,
  pspStakesByAddress: StakedPSPByAddress,
): Claimable[] {
  const claimableAmounts = Object.entries(accTxFeesByAddress).reduce<
    Claimable[]
  >((acc, [address, accTxFees]) => {
    const stakedAmount = pspStakesByAddress[address];

    if (!stakedAmount) {
      //  logger.info(`skipping ${address} as not staked`);
      return acc;
    }

    assert(
      new BigNumber(stakedAmount).gte(minStake),
      'Logic Errror: stakedAmount is lower than min stake',
    ); // should be guaranteed by previous logic

    const refundPercent = getRefundPercent(stakedAmount);

    assert(refundPercent, 'LogicError: refundPercent should be undefined');

    const refundedAmount = new BigNumber(accTxFees.accumulatedGasUsedPSP)
      .multipliedBy(refundPercent)
      .toFixed(0);

    acc.push({
      address,
      amount: refundedAmount,
      // todo: maybe doesn't make sense to return here (as this func deals with refund calculation)
      lastBlockNum: accTxFees.lastBlockNum,
      totalStakeAmountPSP: stakedAmount,
    });

    return acc;
  }, []);

  logger.info(`found ${claimableAmounts.length} eligble for gas refund`);

  return claimableAmounts;
}
