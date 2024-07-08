import * as pMemoize from 'p-memoize';
import { MinParaBoostData, fetchAccountsScores } from './staking-supervisor';
import BigNumber from 'bignumber.js';
import { BigNumber as BNfromEthers } from 'ethers';
import { GasRefundV2EpochFlip } from '../gas-refund/gas-refund';
import {
  getCurrentEpoch,
  getEpochStartCalcTime,
} from '../gas-refund/epoch-helpers';
import { STAKING_CHAIN_IDS } from '../constants';
import { ProgramAgnosticAddressRewards } from '../../types';
import { assert } from 'ts-essentials';
import * as ERC20ABI from '../abi/erc20.abi.json';
import { Contract } from '@ethersproject/contracts';
import { grp2ConfigByChain } from '../gas-refund/config';
import { Provider } from '../provider';
import { BlockInfo } from '../block-info';
import { TokenItem, getTokenHolders } from './covalent';

const config: Record<number, string> = {
  // @TODO: update this config
  // 47: new BigNumber(1e18).multipliedBy(1000_000).toFixed(),
  47: [
    '40192039080861009090485',
    '98303121571430634340377',
    '323916692371019838183554',
    '887432256209381684726927',
    '284291987025675888319487',
    '25346262768415038383677',
    '342732427701091938796041',
    '80296630684899870281772',
  ]
    .reduce((acc, curr) => acc.plus(curr), new BigNumber(0))
    .toFixed(),
  48: '0',
};
// debugger;
const AURA_REWARDS_START_EPOCH_OLD_STYLE = Math.min(
  ...Object.keys(config).map(Number),
);

const logger = global.LOGGER('aura-rewards');

// TotalSupplySePSP2 = TotalSupply(SePSP2[ethereum]) + TotalSupply(SePSP2[optimism])
async function fetchTotalSupplySePSP2OnTheChain(
  blockNumber: number,
  chainId: number,
): Promise<string> {
  const sePSP2Address = grp2ConfigByChain[chainId].sePSP2;
  assert(sePSP2Address, `sePSP2 address is not defined for chain ${chainId}`);

  const contract = new Contract(
    sePSP2Address,
    ERC20ABI,
    Provider.getJsonRpcProvider(chainId),
  );

  try {
    const totalSupply: BNfromEthers = await contract.totalSupply({
      blockTag: blockNumber,
    });

    // DONE: checked the result here, seems to work fine
    // from RPC:
    // 10: 2248200733537860836142862
    // 1: 36493144844863467534634286
    const result = totalSupply.toString();
    // from covalent
    // 10: 2248200733537860836142862
    // 1: 36493144844863467534634286
    // debugger;
    return result;
  } catch (e) {
    debugger;
    throw e;
  }
}
async function fetchTotalSupplySePSP2(blockNumberByChain: {
  [chain: number]: number;
}): Promise<string> {
  const totalSupplySePSP2entries: [chain: number, balance: string][] =
    await Promise.all(
      STAKING_CHAIN_IDS.map<Promise<[number, string]>>(async chainId => [
        chainId,
        await fetchTotalSupplySePSP2OnTheChain(
          blockNumberByChain[chainId],
          chainId,
        ),
      ]),
    );
  const totalSupplySePSP2ByChainId = Object.fromEntries(
    totalSupplySePSP2entries,
  );

  // done: checked the result here, seems to work fine
  const totalSupplySePSP2 = Object.values(totalSupplySePSP2ByChainId)
    .reduce((acc, curr) => acc.plus(curr), new BigNumber(0))
    .toFixed();

  // debugger;

  return totalSupplySePSP2;
}

async function fetchSePSP2BalancesByUser(
  epochNewStyle: number,
  chainId: number,
) {
  const epochOldStyle = GasRefundV2EpochFlip + epochNewStyle;
  const nextEpochStartTimestamp = await getEpochStartCalcTime(
    epochOldStyle + 1,
  );
  const blockInfo = BlockInfo.getInstance(chainId);
  const nextEpochStartBlock = await blockInfo.getBlockAfterTimeStamp(
    nextEpochStartTimestamp,
  );

  assert(nextEpochStartBlock, 'nextEpochStartBlock should be defined');
  const sePSP2Address = grp2ConfigByChain[chainId].sePSP2;
  assert(sePSP2Address, `sePSP2 address is not defined for chain ${chainId}`);

  const options = {
    token: sePSP2Address,
    chainId,
    blockHeight: String(nextEpochStartBlock),
  };

  const sePSPTokenHolders = await getTokenHolders(options);

  // breakpoint to verify match of totalSupply vs covalent holders combined balance
  // // 10: 2248200733537860836142862
  // // 1: 36493144844863467534634286
  // const totalBalanceAmongHolders = sePSPTokenHolders
  //   .reduce((acc, curr) => acc.plus(curr.balance), new BigNumber(0))
  //   .toFixed();
  // debugger;
  // TODO: add assert here?
  return {
    sePSPTokenHolders,
    nextEpochStartBlock,
  };
}

// fetch all holders from covalent
// AllSePSP2Holders = Unique( Holders(SePSP2[ethereum]) + Holders(SePSP2[optimism]) )
type CovalentHoldersData = { sePSPTokenHolders: TokenItem[] };
type CovalentHoldersDataByNetwork = Record<number, CovalentHoldersData>;
type SePSP2BalancesByNetwork = {
  byNetwork: { [chainId: number]: string };
  combined: string;
};
async function fetchSePSP2BalancesByUserByChain(
  epochNewStyle: number,
): Promise<{
  balancesByAccount: { [account: string]: SePSP2BalancesByNetwork };

  nextEpochStartBlockByChain: {
    [chainId: number]: number; // nextEpochStartBlock: number}
  };
}> {
  const sePSP2BalancesByUserByChainEntries: [
    chainId: number,
    holdersdata: CovalentHoldersData & { nextEpochStartBlock: number },
  ][] = await Promise.all(
    STAKING_CHAIN_IDS.map<
      Promise<[number, CovalentHoldersData & { nextEpochStartBlock: number }]>
    >(async chainId => {
      const { nextEpochStartBlock, ...sePSP2BalancesByUser } =
        await fetchSePSP2BalancesByUser(epochNewStyle, chainId);
      return [chainId, { nextEpochStartBlock, ...sePSP2BalancesByUser }];
    }),
  );

  const sePSP2BalancesByUserByChain = Object.fromEntries(
    sePSP2BalancesByUserByChainEntries,
  );

  function mapCovalentHoldersToSePSP2Balances(
    sePSP2BalancesByUserByChain: CovalentHoldersDataByNetwork,
  ): Record<string, SePSP2BalancesByNetwork> {
    const allSePSP2StakersOnAllNetworksUniqueLowercase = new Set(
      Object.values(sePSP2BalancesByUserByChain)
        .flatMap(v => v.sePSPTokenHolders)
        .map(v => v.address.toLowerCase()),
    );

    const result = Array.from(
      allSePSP2StakersOnAllNetworksUniqueLowercase,
    ).reduce<Record<string, SePSP2BalancesByNetwork>>(
      (acc, sePSP2HolderAddresLowerCase) => {
        const sePSP2BalancesByUser = Object.fromEntries(
          STAKING_CHAIN_IDS.map(chainId => [
            chainId,
            sePSP2BalancesByUserByChain[chainId].sePSPTokenHolders.find(
              v => v.address.toLowerCase() === sePSP2HolderAddresLowerCase,
            )?.balance || '0',
          ]),
        );
        acc[sePSP2HolderAddresLowerCase] = {
          byNetwork: sePSP2BalancesByUser,
          combined: Object.values(sePSP2BalancesByUser)
            .reduce((acc, curr) => acc.plus(curr), new BigNumber(0))
            .toFixed(),
        };
        return acc;
      },
      {},
    );

    // checked seems ok
    // debugger;

    return result;
  }

  return {
    balancesByAccount: mapCovalentHoldersToSePSP2Balances(
      sePSP2BalancesByUserByChain,
    ),
    nextEpochStartBlockByChain: STAKING_CHAIN_IDS.reduce(
      (acc, chainId) => ({
        ...acc,
        [chainId]: sePSP2BalancesByUserByChain[chainId].nextEpochStartBlock,
      }),
      {},
    ),
  };
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

  const { nextEpochStartBlockByChain, ...sePSP2BalancesByUserByChain } =
    await fetchSePSP2BalancesByUserByChain(epoch);

  assertSePSP2BalancesIntegrity(
    sePSP2StakersByAccountLowercase,
    sePSP2BalancesByUserByChain.balancesByAccount,
  );

  logger.info(
    `loaded pre-requisites for computing Aura rewards for epoch ${epoch}`,
  );

  const totalSupplySePSP2 = await fetchTotalSupplySePSP2(
    nextEpochStartBlockByChain,
  );

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
async function computeUserRewardWei(
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
  const userSePSP2Balance: SePSP2BalancesByNetwork =
    sePSP2BalancesByUserByChain.balancesByAccount[user.toLowerCase()];

  // if user is not found amongst sePSP2 holders, no Aura rewards then
  if (!userSePSP2Balance) return '0';

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

export async function composeAuraRewards(
  epochOldStyle: number,
): Promise<ProgramAgnosticAddressRewards[]> {
  const { sePSP2BalancesByUserByChain, totalSupplySePSP2 } =
    await fetchPastEpochData(epochOldStyle - GasRefundV2EpochFlip);

  // init containers for rewards items
  const itemsByNetwork: Record<string, ProgramAgnosticAddressRewards[]> =
    STAKING_CHAIN_IDS.reduce(
      (acc, chainId) => ({
        ...acc,
        [chainId]: [],
      }),
      {},
    );

  // init counter
  const auraRewardDistributionCounter = constructRewardsDistributionCounter();

  await Promise.all(
    Object.entries(sePSP2BalancesByUserByChain.balancesByAccount).map(
      async ([account, balances]) => {
        const totalUserRewardWei = await computeUserRewardWei(
          account,
          epochOldStyle,
          auraRewardDistributionCounter,
        );

        let rewardsRemainder = new BigNumber(totalUserRewardWei);
        const byNetworkEntries = Object.entries(balances.byNetwork);
        for (const [idx, [chainId, balance]] of byNetworkEntries.entries()) {
          const isLastItem = idx === byNetworkEntries.length - 1;

          // if it's last item -- allocate full remainder, to make sure it's 1:1
          const amount = isLastItem
            ? rewardsRemainder
            : new BigNumber(
                new BigNumber(totalUserRewardWei)
                  .multipliedBy(balance)
                  .dividedBy(balances.combined)

                  .toFixed(0),
              );

          if (amount.isZero()) continue;

          itemsByNetwork[chainId].push({
            account,
            amount,
            chainId: Number(chainId),
            debugInfo: {
              chainId,
              totalUserRewardWei,
              chainSePSP2Balance: balance,
              chainReward: amount.toFixed(0),
              combinedTotalSupplySePSP2: totalSupplySePSP2,
            },
          });

          rewardsRemainder = rewardsRemainder.minus(amount);
        }
        // console.log('totalUserRewardWei', totalUserRewardWei);
        // console.log('balances', balances);
        // debugger;
      },
    ),
  );

  const result = Object.values(itemsByNetwork).flat();

  // debugger;

  return result;

  // // split optimism and non-optimism refunds
  // const { optimismRefunds, nonOptimismRefunds } = data.reduce<{
  //   optimismRefunds: AddressRewards[];
  //   nonOptimismRefunds: AddressRewards[];
  // }>(
  //   (acc, curr) => {
  //     if (curr.chainId === CHAIN_ID_OPTIMISM) {
  //       acc.optimismRefunds.push(curr);
  //     } else {
  //       acc.nonOptimismRefunds.push(curr);
  //     }
  //     return acc;
  //   },
  //   {
  //     optimismRefunds: [],
  //     nonOptimismRefunds: [],
  //   },
  // );
  // const optimismRefundEligibleStakers = new Set(
  //   optimismRefunds.map(v => v.account),
  // );
  // // TODO: revisit going from byAccountLowercase to sePSP2StakersByAccountLowercase here
  // const { sePSP2BalancesByUserByChain, totalSupplySePSP2 } =
  //   await fetchPastEpochData(epoch - GasRefundV2EpochFlip);
  // // prepare list of stakers that don't have refund on optimism
  // const stakersNotEligibleForOptimismRefund = new Set(
  //   // TODO: revisit going from byAccountLowercase to sePSP2StakersByAccountLowercase here
  //   // will need to change the approach to distributing blockchain-wise (ethereum vs optimism)
  //   // current code doesn't make sense any more and was updated just for the sake of interim commit
  //   Object.keys(sePSP2BalancesByUserByChain)
  //     // .map(v => v.account)
  //     .filter(account => !optimismRefundEligibleStakers.has(account)),
  // );
  // const rewardsDistributionCounter = constructRewardsDistributionCounter();
  // // compute resulting array by adjusting optimism refunds + creating optimism refunds for those who don't have it
  // const adjustedOptimismRefunds: Promise<AddressRewardsWithAmountsByProgram[]> =
  //   Promise.all(
  //     optimismRefunds.map(async v => {
  //       const aura = await computeUserRewardWei(
  //         v.account,
  //         epoch,
  //         rewardsDistributionCounter,
  //       );
  //       return {
  //         ...v,
  //         amount: v.amount.plus(aura), // add aura rewards to gas refunds json
  //         amountsByProgram: {
  //           aura,
  //           paraswapGasRefund: v.amount.toFixed(),
  //         },
  //       };
  //     }),
  //   );
  // const additionalOptimismRefunds: Promise<
  //   AddressRewardsWithAmountsByProgram[]
  // > = Promise.all(
  //   Array.from(stakersNotEligibleForOptimismRefund).map<
  //     Promise<AddressRewardsWithAmountsByProgram>
  //   >(async account => {
  //     const aura = await computeUserRewardWei(
  //       account,
  //       epoch,
  //       rewardsDistributionCounter,
  //     );
  //     return {
  //       account,
  //       amount: new BigNumber(aura),
  //       chainId: CHAIN_ID_OPTIMISM,
  //       amountsByProgram: {
  //         aura,
  //         paraswapGasRefund: '0', // the value is chain specific, relates to the `amount` field, not to total amount accross all networks
  //       },
  //       breakDownGRP: STAKING_CHAIN_IDS.reduce<Record<number, BigNumber>>(
  //         (acc, curr) => {
  //           acc[curr] = new BigNumber(0);
  //           return acc;
  //         },
  //         {},
  //       ),
  //     };
  //   }),
  // );
  // const nonOptimismRefundsWithAmountsByProgram: AddressRewardsWithAmountsByProgram[] =
  //   nonOptimismRefunds.map(v => ({
  //     ...v,
  //     amountsByProgram: {
  //       aura: '0',
  //       paraswapGasRefund: v.amount.toFixed(),
  //     },
  //   }));
  // const newAllRefunds = (
  //   await Promise.all([adjustedOptimismRefunds, additionalOptimismRefunds])
  // )
  //   .flat()
  //   .concat(nonOptimismRefundsWithAmountsByProgram);
  // try {
  //   assert(
  //     rewardsDistributionCounter.rewardsAllocated == BigInt(config[epoch]),
  //     'rewards distribution counter does not match the total rewards',
  //   );
  // } catch (e) {
  //   debugger;
  //   throw e;
  // }
  // assert(
  //   rewardsDistributionCounter.sePSP2BalanceCleared ===
  //     BigInt(totalSupplySePSP2),
  //   'rewards distribution counter does not match the total supply of sePSP2',
  // );
  // return newAllRefunds;
  return [];
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

// see if the stakers list is inclusive of all holders (throw exception)
function assertSePSP2BalancesIntegrity(
  sePSP2StakersByAccountLowercase: Record<string, MinParaBoostData>,
  sePSP2BalancesByUserByChain: Record<string, SePSP2BalancesByNetwork>,
) {
  assert(
    Object.keys(sePSP2StakersByAccountLowercase).length ===
      Object.keys(sePSP2BalancesByUserByChain).length,
    'sePSP2StakersByAccountLowercase and sePSP2BalancesByUserByChain should have the same length',
  );
  Object.keys(sePSP2StakersByAccountLowercase).forEach(account => {
    assert(
      sePSP2BalancesByUserByChain[account.toLowerCase()],
      `account ${account} is missing in sePSP2BalancesByUserByChain`,
    );
  });
  // the above two checks should be enough to verify 2 sources return the same set of accounts?
  // debugger;
}
