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
import { assert } from 'ts-essentials';

const config: Record<number, string> = {
  // @TODO: update this config
  47: new BigNumber(1e18).multipliedBy(1000_000).toFixed(),
};

const AURA_REWARDS_START_EPOCH_OLD_STYLE = Math.min(
  ...Object.keys(config).map(Number),
);

const logger = global.LOGGER('aura-rewards');

// TotalSupplySePSP2 = TotalSupply(SePSP2[ethereum]) + TotalSupply(SePSP2[optimism])
async function fetchTotalSupplySePSP2(epoch: number): Promise<string> {
  throw new Error('TODO: Function not implemented.');
  return '123';
}

// TODO: fetch all holders from covalent?
// AllSePSP2Holders = Unique( Holders(SePSP2[ethereum]) + Holders(SePSP2[optimism]) )
async function fetchSePSP2BalancesByUserByChain(
  epoch: number,
): Promise<Record<string, Record<1 | 10 | 'combined', string>>> {
  throw new Error('TODO: Function not implemented.');
  return {};
}
async function _fetchEpochData(epoch: number) {
  const list = await fetchAccountsScores(epoch);

  const sePSP2StakersByAccountLowercase = list.reduce<
    Record<string, MinParaBoostData>
  >((acc, curr) => {
    if (Number(curr.sePSP2UnderlyingPSPBalance) > 0) {
      acc[curr.account.toLowerCase()] = curr;
    }
    return acc;
  }, {});

  const sePSP2BalancesByUserByChain = await fetchSePSP2BalancesByUserByChain(
    epoch,
  );

  assertSePSP2BalancesIntegrity(
    sePSP2StakersByAccountLowercase,
    sePSP2BalancesByUserByChain,
  );

  logger.info(
    `loaded pre-requisites for computing Aura rewards for epoch ${epoch}`,
  );

  const totalSupplySePSP2 = await fetchTotalSupplySePSP2(epoch);

  return {
    totalSupplySePSP2,
    sePSP2BalancesByUserByChain,
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

  assert(
    config[epochOldStyle],
    `config for epoch [${epochOldStyle}] is not defined`,
  );

  const epoch = epochOldStyle - GasRefundV2EpochFlip;
  const { sePSP2BalancesByUserByChain, totalSupplySePSP2 } =
    await fetchPastEpochData(epoch);

  // after going from byAccountLowercase to sePSP2BalancesByUserByChain here, it relies on sePSP2 balances rather than scores.
  const userSePSP2Balance: {
    1: string;
    10: string;
    combined: string;
  } = sePSP2BalancesByUserByChain[user.toLowerCase()];

  const totalRewards = config[epochOldStyle] || '0';
  const remainingRewards = new BigNumber(totalRewards)
    .minus(counter.rewardsAllocated.toString())
    .toFixed();
  const remainingTotalScore = new BigNumber(totalSupplySePSP2)
    .minus(counter.sePSP2BalanceCleared.toString())
    .toFixed();
  const userRewards = new BigNumber(userSePSP2Balance.combined)
    .times(remainingRewards)
    .div(remainingTotalScore)
    .toFixed(0);

  // deduct from remaining rewards and scores - to guarantee that there is no remainder or excession
  counter.count(BigInt(userSePSP2Balance.combined), BigInt(userRewards));

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
      optimismRefunds: [],
      nonOptimismRefunds: [],
    },
  );

  const optimismRefundEligibleStakers = new Set(
    optimismRefunds.map(v => v.account),
  );

  // TODO: revisit going from byAccountLowercase to sePSP2StakersByAccountLowercase here
  const { sePSP2BalancesByUserByChain, totalSupplySePSP2 } =
    await fetchPastEpochData(epoch - GasRefundV2EpochFlip);
  // prepare list of stakers that don't have refund on optimism
  const stakersNotEligibleForOptimismRefund = new Set(
    // TODO: revisit going from byAccountLowercase to sePSP2StakersByAccountLowercase here
    // will need to change the approach to distributing blockchain-wise (ethereum vs optimism)
    // current code doesn't make sense any more and was updated just for the sake of interim commit
    Object.keys(sePSP2BalancesByUserByChain)
      // .map(v => v.account)
      .filter(account => !optimismRefundEligibleStakers.has(account)),
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
          amount: v.amount.plus(aura), // add aura rewards to gas refunds json
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
    Array.from(stakersNotEligibleForOptimismRefund).map<
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

  assert(
    rewardsDistributionCounter.rewardsAllocated == BigInt(config[epoch]),
    'rewards distribution counter does not match the total rewards',
  );
  assert(
    rewardsDistributionCounter.sePSP2BalanceCleared ===
      BigInt(totalSupplySePSP2),
    'rewards distribution counter does not match the total supply of sePSP2',
  );

  return newAllRefunds;
}

type RewardsDistributionCounter = {
  sePSP2BalanceCleared: BigInt;
  rewardsAllocated: BigInt;
  count: (userSePSP2Balance: BigInt, userRewards: BigInt) => void;
};
function constructRewardsDistributionCounter(): RewardsDistributionCounter {
  return {
    sePSP2BalanceCleared: BigInt(0),
    rewardsAllocated: BigInt(0),
    count(userSePSP2Balance: BigInt, userRewards: BigInt) {
      this.sePSP2BalanceCleared += userSePSP2Balance;
      this.rewardsAllocated += userRewards;
    },
  };
}
function assertSePSP2BalancesIntegrity(
  sePSP2StakersByAccountLowercase: Record<string, MinParaBoostData>,
  sePSP2BalancesByUserByChain: Record<
    string,
    Record<1 | 10 | 'combined', string>
  >,
) {
  // see if the stakers list is inclusive of all holders (throw exception)
  throw new Error('TODO: Function not implemented.');
}
