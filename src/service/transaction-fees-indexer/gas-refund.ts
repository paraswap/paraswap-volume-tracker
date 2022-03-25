import BigNumber from 'bignumber.js';
import { assert } from 'ts-essentials';
import { Claimable, TxFeesByAddress } from './types';

const logger = global.LOGGER('GRP:GAS_REFUND_COMPUTATION');

type GasRefundLevel = 'level_1' | 'level_2' | 'level_3' | 'level_4';

type GasRefundLevelsDef = {
  level: GasRefundLevel;
  minStakedAmount: BigNumber;
  refundPercent: number;
};

//                                                  psp decimals
const scale = (num: number) => new BigNumber(num).multipliedBy(1e18);

const minStake = scale(500); // @FIXME: resolve min stake automatically

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

const getRefundPercent = (stakedAmount: BigNumber): number | undefined =>
  gasRefundLevels.find(({ minStakedAmount }) =>
    stakedAmount.gte(minStakedAmount),
  )?.refundPercent;

// @FIXME: read accumulated tx fees by address and gas refund level -> reduce claimable amounts
export function reduceGasRefundByAddress(
  accTxFeesByAddress: TxFeesByAddress,
  pspStakesByAddress: { [address: string]: BigNumber },
): Claimable[] {
  const claimableAmounts = Object.entries(accTxFeesByAddress).reduce<
    Claimable[]
  >((acc, [address, accTxFees]) => {
    const stakedAmount = pspStakesByAddress[address];

    if (!stakedAmount) {
      //  logger.info(`skipping ${address} as not staked`);
      return acc;
    }

    if (stakedAmount.lt(minStake)) {
      logger.info(`skipping ${address} as not staked enough (${stakedAmount})`);
      return acc;
    }

    const refundPercent = getRefundPercent(stakedAmount);

    assert(refundPercent, 'LogicError: refundPercent should be undefined');

    const refundedAmount = accTxFees.accGasFeePSP
      .multipliedBy(refundPercent)
      .toFixed(0);

    acc.push({
      address,
      amount: refundedAmount,
    });

    return acc;
  }, []);

  logger.info(`found ${claimableAmounts.length} eligble for gas refund`);

  return claimableAmounts;
}
