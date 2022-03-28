import BigNumber from 'bignumber.js';

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

export const getRefundPercent = (stakedAmount: string): number | undefined =>
  gasRefundLevels.find(({ minStakedAmount }) =>
    new BigNumber(stakedAmount).gte(minStakedAmount),
  )?.refundPercent;
