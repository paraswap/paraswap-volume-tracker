import '../../src/lib/log4js';
import * as dotenv from 'dotenv';
import {Op} from 'sequelize';
import {computeMerkleData} from './refund/merkle-tree';
import {fetchLastEpochRefunded, saveMerkleTreeInDB,} from './persistance/db-persistance';

import {assert} from 'ts-essentials';
import {GasRefundGenesisEpoch, TransactionStatus,} from '../../src/lib/gas-refund/gas-refund';
import {GasRefundTransaction} from '../../src/models/GasRefundTransaction';
import {saveMerkleTreeInFile} from './persistance/file-persistance';

import Database from '../../src/database';
import {
  getCurrentEpoch,
  loadEpochMetaData,
  resolveEpochCalcTimeInterval,
} from '../../src/lib/gas-refund/epoch-helpers';
import {STAKING_CHAIN_IDS} from "../../src/lib/constants";
import {StakeV2Resolver} from "./staking/2.0/StakeV2Resolver";
import BigNumber from "bignumber.js";
import {isTruthy} from "../../src/lib/utils";

dotenv.config();

const logger = global.LOGGER('GRP:COMPUTE_MERKLE_TREE');

const skipCheck = process.env.SKIP_CHECKS === 'true';
const saveFile = process.env.SAVE_FILE === 'true';

type RefundableTransaction = {
    address: string;
    timestamp: number;
    refundedAmountPSP: string;
}
export async function getRefundableTransactionData(epoch: number): Promise<RefundableTransaction[]> {
    const numOfIdleTxs = await GasRefundTransaction.count({
        where: { epoch, status: TransactionStatus.IDLE },
    });
    assert(numOfIdleTxs === 0, `there should be 0 idle transactions for epoch=${epoch}`);

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
        attributes: [
            'address',
            'timestamp',
            'refundedAmountPSP',
        ],
        raw: true,
    });
}

export async function computeAndStoreMerkleTree(epoch: number) {
    const userRewardsOnStakingChains = await computeStakingChainsRefundedAmounts(epoch);

    const userRewards: {account: string, amount: BigNumber, chainId: number}[] = Object.keys(userRewardsOnStakingChains)
        .map(account =>
            Object.entries(userRewardsOnStakingChains[account])
              .map(([chainId, amount]) => ({
                  chainId: +chainId,
                  amount,
                  account,
              }))
        ).flat()
        .filter(entry => !entry.amount.eq(0))

      const merkleTreeData = await computeMerkleData({userRewards, epoch});

    return Promise.all(merkleTreeData.map(async ({chainId, merkleTree}) => {
        if (saveFile) {
            logger.info('saving merkle tree in file');
            await saveMerkleTreeInFile({ chainId: +chainId, epoch, merkleTree });
        } else {
            logger.info('saving merkle tree in db');
            await saveMerkleTreeInDB({ chainId: +chainId, epoch, merkleTree });
        }
    }))

}

async function computeStakingChainsRefundedAmounts(epoch: number) {
    const refundableTransactions = (await getRefundableTransactionData(epoch)).flat();

    const refundableTransactionsByAccount = refundableTransactions
        .reduce<{[account: string]: RefundableTransaction[]}>(
            (acc, curr) => {
                if (!acc[curr.address]) acc[curr.address] = [];

                acc[curr.address].push(curr);

                return acc;
            }, {}
        );

    const stakeResolvers: { [chainId: number]: StakeV2Resolver } = {};

    const {startCalcTime, endCalcTime} = await resolveEpochCalcTimeInterval(epoch);
    for (const chainId of STAKING_CHAIN_IDS) {
      stakeResolvers[chainId] = StakeV2Resolver.getInstance(chainId);

      await stakeResolvers[chainId].loadWithinInterval(startCalcTime, endCalcTime)
    }

    const userRewardsOnStakingChains: {[account: string]: {[chainId: number]: BigNumber}} = {};

    Object.entries(refundableTransactionsByAccount)
        .forEach(([account, refundTransactions]) => {
            userRewardsOnStakingChains[account] = refundTransactions
                .reduce<{[chainId: number]: BigNumber}>((acc, curr) => {

                    let refundTransactionRemainingRefundableAmount = new BigNumber(curr.refundedAmountPSP);
                  const stakesForTimestamp = STAKING_CHAIN_IDS.map(chainId => {

                      if (
                        stakeResolvers[chainId].startTimestamp <= curr.timestamp
                        && stakeResolvers[chainId].endTimestamp >= curr.timestamp
                      ) {
                        return {
                          chainId,
                          stake: stakeResolvers[chainId].getStakeForRefund(curr.timestamp, account)
                        };
                      }

                      return null;
                    }
                  ).filter(isTruthy);

                    const totalStakesAtTimestamp = Object.values(stakesForTimestamp)
                        .reduce((sum, e) => sum.plus(e.stake), new BigNumber(0));


                    stakesForTimestamp.forEach((entry) => {
                        if(!acc[entry.chainId]) acc[entry.chainId] = new BigNumber(0);
                        const refundAmountForChain = entry.stake.multipliedBy(curr.refundedAmountPSP).dividedBy(totalStakesAtTimestamp);
                        refundTransactionRemainingRefundableAmount = refundTransactionRemainingRefundableAmount.minus(refundAmountForChain);

                        acc[entry.chainId] = acc[entry.chainId].plus(refundAmountForChain)
                    });

                    if (!refundTransactionRemainingRefundableAmount.eq(0)) {
                        for (const entry of stakesForTimestamp) {
                            if (!entry.stake.eq(0)) {
                                acc[entry.chainId] = acc[entry.chainId].eq(0)
                                    ? new BigNumber(refundTransactionRemainingRefundableAmount)
                                    : acc[entry.chainId].plus(refundTransactionRemainingRefundableAmount);
                                break;
                            }
                        }
                    }

                    return acc;
                }, {});
        });

    return userRewardsOnStakingChains;
}

async function startComputingMerkleTreesAllChains() {
  await Database.connectAndSync();
  await loadEpochMetaData();

  const latestEpochRefunded = await fetchLastEpochRefunded(skipCheck);
  let startEpoch = latestEpochRefunded
    ? latestEpochRefunded + 1
    : GasRefundGenesisEpoch;

  assert(
    startEpoch >= GasRefundGenesisEpoch,
    'cannot compute grp merkle data for epoch < genesis_epoch',
  );

  const currentEpoch = getCurrentEpoch();

  for (let epoch = startEpoch; epoch <= currentEpoch; epoch++) {
    const { isEpochEnded } = await resolveEpochCalcTimeInterval(epoch);

    if (!skipCheck && !isEpochEnded) {
      return logger.warn(
        `Epoch ${epoch} has not ended or full onchain data not available yet`,
      );
    }

    await computeAndStoreMerkleTree(epoch);
  }
}

startComputingMerkleTreesAllChains()
  .then(() => process.exit(0))
  .catch(err => {
    logger.error('computeMerkleTreesAllChains exited with error:', err);
    process.exit(1);
  });
