import { Op } from 'sequelize';
import { computeMerkleData } from './merkle-tree';

import BigNumber from 'bignumber.js';
import { assert } from 'ts-essentials';
import { STAKING_CHAIN_IDS } from '../../../../src/lib/constants';
import { resolveEpochCalcTimeInterval } from '../../../../src/lib/gas-refund/epoch-helpers';
import {
  TransactionStatus,
  stringifyGRPChainBreakDown,
} from '../../../../src/lib/gas-refund/gas-refund';
import { isTruthy } from '../../../../src/lib/utils';
import { GasRefundTransaction } from '../../../../src/models/GasRefundTransaction';
import { composeRefundWithPIP38Refunds } from '../../pip38';
import { StakeV2Resolver } from '../../staking/2.0/StakeV2Resolver';
import {
  AddressChainRewardsMapping,
  AddressRewards,
  AddressRewardsMapping,
  ChainRewardsMapping,
  MerkleTreeAndChain,
} from './types';
import { AddressRewardsWithAmountsByProgram } from '../../../../src/types';

function combinePrograms(
  input: { programName: string; rewards: AddressRewards[] }[],
): AddressRewardsWithAmountsByProgram[] {
  // TODO
  return [];
}

// accepts list of distribution entries
// returns [extended] list of distribution entries, the items of which are extended with "amount by program" and the amount adjusted respectively
export async function composeWithAmountsByProgram(
  epoch: number,
  originalGasRefundProgramItems: AddressRewards[],
): Promise<AddressRewardsWithAmountsByProgram[]> {
  // 1. compute AddressRewards[] rows for Aura Program
  // 2. combined AddressRewardsWithAmountsByProgram[] = Aura + GasRefund
  return combinePrograms([
    {
      programName: 'paraswapGasRefund',
      rewards: originalGasRefundProgramItems,
    },
    {
      programName: 'auraRewards',
      rewards: [], // TODO: compute Aura rewards
    },
  ]);
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
}

function asserted<T>(val: T) {
  assert(val !== null && val !== undefined, 'val should not be null or undef');

  return val;
}

type RefundableTransaction = {
  address: string;
  timestamp: number;
  chainId: number;
  refundedAmountPSP: string;
};
export async function getRefundableTransactionData(
  epoch: number,
): Promise<RefundableTransaction[]> {
  const numOfIdleTxs = await GasRefundTransaction.count({
    where: { epoch, status: TransactionStatus.IDLE },
  });
  assert(
    numOfIdleTxs === 0,
    `there should be 0 idle transactions for epoch=${epoch}`,
  );

  return GasRefundTransaction.findAll({
    where: {
      epoch,
      status: TransactionStatus.VALIDATED,
      ...(epoch >= 32
        ? {
            refundedAmountPSP: {
              [Op.gt]: 0, // on epoch=31 the merkle tree got 0s
            },
          }
        : {}),
    },
    attributes: ['address', 'timestamp', 'refundedAmountPSP', 'chainId'],
    raw: true,
  });
}

async function computeStakingChainsRefundedAmounts(epoch: number) {
  const refundableTransactions = (
    await getRefundableTransactionData(epoch)
  ).flat();

  const refundableTransactionsByAccount = refundableTransactions.reduce<{
    [account: string]: RefundableTransaction[];
  }>((acc, curr) => {
    if (!acc[curr.address]) acc[curr.address] = [];

    acc[curr.address].push(curr);

    return acc;
  }, {});

  const stakeResolvers: { [chainId: number]: StakeV2Resolver } = {};

  const { startCalcTime, endCalcTime } = await resolveEpochCalcTimeInterval(
    epoch,
  );
  for (const chainId of STAKING_CHAIN_IDS) {
    stakeResolvers[chainId] = StakeV2Resolver.getInstance(chainId);

    await stakeResolvers[chainId].loadWithinInterval(
      startCalcTime,
      endCalcTime,
    );
  }

  const userRewardsOnStakingChains: AddressChainRewardsMapping = {};

  Object.entries(refundableTransactionsByAccount).forEach(
    ([account, refundTransactions]) => {
      userRewardsOnStakingChains[account] =
        refundTransactions.reduce<ChainRewardsMapping>((acc, curr) => {
          let refundTransactionRemainingRefundableAmount = new BigNumber(
            curr.refundedAmountPSP,
          );
          const stakesForTimestamp = STAKING_CHAIN_IDS.map(chainId => {
            if (
              stakeResolvers[chainId].startTimestamp <= curr.timestamp &&
              stakeResolvers[chainId].endTimestamp >= curr.timestamp
            ) {
              return {
                chainId,
                stake: stakeResolvers[chainId].getStakeForRefund(
                  curr.timestamp,
                  account,
                ),
              };
            }

            return null;
          }).filter(isTruthy);

          const totalStakesAtTimestamp = Object.values(
            stakesForTimestamp,
          ).reduce(
            (sum, e) => sum.plus(asserted(e.stake?.stakeScore) || 0),
            new BigNumber(0),
          );

          stakesForTimestamp.forEach(entry => {
            if (!acc[entry.chainId])
              acc[entry.chainId] = {
                amount: new BigNumber(0),
                breakDownGRP: {},
              };
            const refundAmountForChain = new BigNumber(
              asserted(entry.stake?.stakeScore) || 0,
            )
              .multipliedBy(curr.refundedAmountPSP)
              .dividedBy(totalStakesAtTimestamp)
              .decimalPlaces(0, BigNumber.ROUND_DOWN);

            refundTransactionRemainingRefundableAmount =
              refundTransactionRemainingRefundableAmount.minus(
                refundAmountForChain,
              );

            acc[entry.chainId].amount =
              acc[entry.chainId].amount.plus(refundAmountForChain);
            if (!acc[entry.chainId].breakDownGRP[curr.chainId]) {
              acc[entry.chainId].breakDownGRP[curr.chainId] = new BigNumber(
                refundAmountForChain,
              );
            } else {
              acc[entry.chainId].breakDownGRP[curr.chainId] =
                acc[entry.chainId].breakDownGRP[curr.chainId].plus(
                  refundAmountForChain,
                );
            }
          });

          if (!refundTransactionRemainingRefundableAmount.eq(0)) {
            for (const entry of stakesForTimestamp) {
              if (asserted(entry.stake?.stakeScore) !== '0') {
                if (acc[entry.chainId].amount.eq(0)) {
                  acc[entry.chainId].amount = new BigNumber(
                    refundTransactionRemainingRefundableAmount,
                  );
                } else {
                  acc[entry.chainId].amount = acc[entry.chainId].amount.plus(
                    refundTransactionRemainingRefundableAmount,
                  );
                }

                if (!acc[entry.chainId].breakDownGRP[curr.chainId]) {
                  acc[entry.chainId].breakDownGRP[curr.chainId] = new BigNumber(
                    refundTransactionRemainingRefundableAmount,
                  );
                } else {
                  acc[entry.chainId].breakDownGRP[curr.chainId] = acc[
                    entry.chainId
                  ].breakDownGRP[curr.chainId].plus(
                    refundTransactionRemainingRefundableAmount,
                  );
                }
                break;
              }
            }
          }

          return acc;
        }, {});
    },
  );

  return userRewardsOnStakingChains;
}

export async function computeDistributionMerkleData(
  epoch: number,
): Promise<MerkleTreeAndChain[]> {
  const userRewardsOnStakingChains = await computeStakingChainsRefundedAmounts(
    epoch,
  );

  const _allChainsRefunds: AddressRewards[] = Object.keys(
    userRewardsOnStakingChains,
  )
    .map(account =>
      Object.entries(userRewardsOnStakingChains[account]).map(
        ([chainId, { amount, breakDownGRP }]) => ({
          chainId: +chainId,
          amount,
          breakDownGRP,
          account,
        }),
      ),
    )
    .flat()
    .filter(
      entry =>
        !entry.amount.eq(0) &&
        // isNaN check to cover unstakes
        !entry.amount.isNaN(),
    );

  const withPIP38 = composeRefundWithPIP38Refunds(epoch, _allChainsRefunds);

  const allChainsRefunds = await composeWithAmountsByProgram(epoch, withPIP38);

  const userGRPChainsBreakDowns = allChainsRefunds.reduce<{
    [stakeChainId: number]: AddressRewardsMapping;
  }>((acc, curr) => {
    if (!acc[curr.chainId]) acc[curr.chainId] = {};
    acc[curr.chainId][curr.account] = {
      byChain: curr.breakDownGRP,
      amountsByProgram: curr.amountsByProgram,
    };

    return acc;
  }, {});

  const merkleTreeData = await computeMerkleData({
    userRewards: allChainsRefunds,
    epoch,
  });

  // TODO ADD MORE SANITY CHECK

  merkleTreeData.forEach(({ chainId, merkleTree }) => {
    merkleTree.merkleProofs.forEach(l => {
      const GRPChainBreakDown =
        userGRPChainsBreakDowns[+chainId][l.address].byChain;
      if (GRPChainBreakDown) {
        l.GRPChainBreakDown = stringifyGRPChainBreakDown(GRPChainBreakDown);
        l.amountsByProgram =
          userGRPChainsBreakDowns[+chainId][l.address].amountsByProgram;
      }
    });
  });
  return merkleTreeData;
}
