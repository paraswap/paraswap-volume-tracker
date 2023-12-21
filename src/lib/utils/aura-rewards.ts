import * as pMemoize from 'p-memoize';
import { MinParaBoostData, fetchAccountsScores } from './staking-supervisor';
import BigNumber from 'bignumber.js';
import { GasRefundV2EpochFlip } from '../gas-refund/gas-refund';
import { getCurrentEpoch } from '../gas-refund/epoch-helpers';
import { CHAIN_ID_OPTIMISM, STAKING_CHAIN_IDS } from '../constants';
import {
  AddressRewards,
  AddressRewardsWithAmountsByProgram,
} from '../../types';

const config: Record<number, string> = {
  // @TODO: update this config
  41: '69311354102943179612461',
};

const AURA_REWARDS_START_EPOCH_OLD_STYLE = Math.min(
  ...Object.keys(config).map(Number),
);

const logger = global.LOGGER('aura-rewards');

async function _fetchEpochData(epoch: number) {
  const list = await fetchAccountsScores(epoch);

  const byAccountLowercase = list.reduce<Record<string, MinParaBoostData>>(
    (acc, curr) => {
      acc[curr.account.toLowerCase()] = curr;
      return acc;
    },
    {},
  );

  logger.info(
    `loaded pre-requisites for computing Aura rewards for epoch ${epoch}`,
  );

  // computing total with BigNumber instead of taking it from the endpoint
  const totalScore = list
    .reduce((acc, curr) => {
      return acc.plus(curr.score);
    }, new BigNumber(0))
    .toFixed();

  return {
    totalScore,
    list,
    byAccountLowercase,
  };
}

// cache forever
const fetchPastEpochData = pMemoize(_fetchEpochData, {
  cacheKey: ([epoch]) => `paraboost_epochData_${epoch}`,
});

// is used during when executing distribution script.
// is intended to compute user rewards for the current epoch without remainder
export async function computeUserRewardWei(
  user: string,
  epochOldStyle: number,
  counter: RewardsDistributionCounter,
) {
  if (epochOldStyle == getCurrentEpoch()) {
    // not known yet - hence display 0
    return '0';
  }

  // for epochs before Aura rewards started, return 0
  if (epochOldStyle < AURA_REWARDS_START_EPOCH_OLD_STYLE) return '0';

  const epoch = epochOldStyle - GasRefundV2EpochFlip;
  const { byAccountLowercase, totalScore } = await fetchPastEpochData(epoch);

  const userScore = byAccountLowercase[user.toLowerCase()]?.score || '0';

  const totalRewards = config[epochOldStyle] || '0';
  const remainingRewards = new BigNumber(totalRewards)
    .minus(counter.rewardsAllocated.toString())
    .toFixed();
  const remainingTotalScore = new BigNumber(totalScore)
    .minus(counter.scoreCleared.toString())
    .toFixed();
  const userRewards = new BigNumber(userScore)
    .times(remainingRewards)
    .div(remainingTotalScore)
    .toFixed(0, BigNumber.ROUND_HALF_FLOOR);

  // deduct from remaining rewards and scores - to guarantee that there is no remainder or excession
  counter.count(BigInt(userScore), BigInt(userRewards));

  return userRewards;
}

export async function composeWithAmountsByProgram(
  epoch: number,
  data: AddressRewards[],
): Promise<AddressRewardsWithAmountsByProgram[]> {
  // split optimism and non-optimism refunds
  const { optimismRefunds, nonOptimismRefunds } = data.reduce<{
    optimismRefunds: AddressRewards[];
    nonOptimismRefunds: AddressRewards[];
  }>(
    (acc, curr) => {
      if (curr.chainId === CHAIN_ID_OPTIMISM) {
        acc.optimismRefunds.push(curr);
      } else {
        acc.nonOptimismRefunds.push(curr);
      }
      return acc;
    },
    {
      optimismRefunds: [] as AddressRewards[],
      nonOptimismRefunds: [] as AddressRewards[],
    },
  );

  const optimismStakers = new Set(optimismRefunds.map(v => v.account));
  const { byAccountLowercase } = await fetchPastEpochData(
    epoch - GasRefundV2EpochFlip,
  );
  // prepare list of stakers that don't have refund on optimism
  const nonOptimismStakers = new Set(
    Object.keys(byAccountLowercase)
      // .map(v => v.account)
      .filter(account => !optimismStakers.has(account)),
  );

  const rewardsDistributionCounter = constructRewardsDistributionCounter();
  // compute resulting array by adjusting optimism refunds + creating optimism refunds for those who don't have it
  const adjustedOptimismRefunds: Promise<AddressRewardsWithAmountsByProgram[]> =
    Promise.all(
      optimismRefunds.map(async v => {
        const aura = await computeUserRewardWei(
          v.account,
          epoch,
          rewardsDistributionCounter,
        );
        return {
          ...v,
          amount: new BigNumber(v.amount).plus(aura), // add aura rewards to gas refunds json
          amountsByProgram: {
            aura,
            paraswapGasRefund: v.amount.toFixed(),
          },
        };
      }),
    );

  const additionalOptimismRefunds: Promise<
    AddressRewardsWithAmountsByProgram[]
  > = Promise.all(
    Array.from(nonOptimismStakers).map<
      Promise<AddressRewardsWithAmountsByProgram>
    >(async account => {
      const aura = await computeUserRewardWei(
        account,
        epoch,
        rewardsDistributionCounter,
      );
      return {
        account,
        amount: new BigNumber(aura),
        chainId: CHAIN_ID_OPTIMISM,
        amountsByProgram: {
          aura,
          paraswapGasRefund: '0', // the value is chain specific, relates to the `amount` field, not to total amount accross all networks
        },
        breakDownGRP: STAKING_CHAIN_IDS.reduce<Record<number, BigNumber>>(
          (acc, curr) => {
            acc[curr] = new BigNumber(0);
            return acc;
          },
          {},
        ),
      };
    }),
  );

  const nonOptimismRefundsWithAmountsByProgram: AddressRewardsWithAmountsByProgram[] =
    nonOptimismRefunds.map(v => ({
      ...v,
      amountsByProgram: {
        aura: '0',
        paraswapGasRefund: v.amount.toFixed(),
      },
    }));

  const newAllRefunds = (
    await Promise.all([adjustedOptimismRefunds, additionalOptimismRefunds])
  )
    .flat()
    .concat(nonOptimismRefundsWithAmountsByProgram);

  return newAllRefunds;
}

type RewardsDistributionCounter = {
  scoreCleared: BigInt;
  rewardsAllocated: BigInt;
  count: (userScore: BigInt, userRewards: BigInt) => void;
};
function constructRewardsDistributionCounter(): RewardsDistributionCounter {
  return {
    scoreCleared: BigInt(0),
    rewardsAllocated: BigInt(0),
    count(userScore: BigInt, userRewards: BigInt) {
      this.scoreCleared += userScore;
      this.rewardsAllocated += userRewards;
    },
  };
}
