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
    .filter(entry => !entry.amount.eq(0));

  const allChainsRefunds = composeRefundWithPIP38Refunds(
    epoch,
    _allChainsRefunds,
  );

  const userGRPChainsBreakDowns = allChainsRefunds.reduce<{
    [stakeChainId: number]: AddressRewardsMapping;
  }>((acc, curr) => {
    if (!acc[curr.chainId]) acc[curr.chainId] = {};
    acc[curr.chainId][curr.account] = curr.breakDownGRP;

    return acc;
  }, {});

  const merkleTreeData = await computeMerkleData({
    userRewards: allChainsRefunds,
    epoch,
  });

  // TODO ADD MORE SANITY CHECK

  merkleTreeData.forEach(({ chainId, merkleTree }) => {
    merkleTree.leaves.forEach(l => {
      const GRPChainBreakDown = userGRPChainsBreakDowns[+chainId][l.address];
      if (GRPChainBreakDown) {
        l.GRPChainBreakDown = stringifyGRPChainBreakDown(GRPChainBreakDown);
      }
    });
  });

  return merkleTreeData;
}
