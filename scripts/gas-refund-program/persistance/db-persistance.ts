import {
  GRP_SUPPORTED_CHAINS,
  GasRefundTransactionData,
  GasRefundParticipantData,
  TransactionStatus,
} from '../../../src/lib/gas-refund';
import { GasRefundParticipation } from '../../../src/models/GasRefundParticipation';
import { GasRefundTransaction } from '../../../src/models/GasRefundTransaction';
import { GasRefundDistribution } from '../../../src/models/GasRefundDistribution';
import { MerkleData, MerkleTreeData } from '../types';
import { sliceCalls } from '../utils';
import { Sequelize } from 'sequelize';
import BigNumber from 'bignumber.js';

export async function fetchVeryLastTimestampProcessed({
  chainId,
  epoch,
}: {
  chainId: number;
  epoch: number;
}): Promise<number> {
  const lastTimestamp = await GasRefundTransaction.max<
    number,
    GasRefundTransaction
  >('timestamp', {
    where: { chainId, epoch },
  });

  return lastTimestamp;
}

export async function fetchTotalRefundedPSP(): Promise<BigNumber> {
  const totalPSPRefunded = await GasRefundTransaction.sum<
    string,
    GasRefundTransaction
  >('refundedAmountPSP', {
    where: {
      status: TransactionStatus.VALIDATED,
    },
  });

  return new BigNumber(totalPSPRefunded);
}

export async function fetchTotalRefundedAmountUSDByAddress(): Promise<{
  [address: string]: BigNumber;
}> {
  const totalRefundedAmountUSDAllAddresses =
    (await GasRefundTransaction.findAll({
      attributes: [
        'address',
        [
          Sequelize.fn('SUM', Sequelize.col('refundedAmountUSD')),
          'totalRefundedAmountUSD',
        ],
      ],
      where: {
        status: TransactionStatus.VALIDATED,
      },
      group: 'address',
      raw: true,
    })) as unknown as { address: string; totalRefundedAmountUSD: string }[];

  const totalRefundedAmountUSDByAddress =
    totalRefundedAmountUSDAllAddresses.reduce<{ [address: string]: BigNumber }>(
      (acc, curr) => {
        acc[curr.address] = new BigNumber(curr.totalRefundedAmountUSD);
        return acc;
      },
      {},
    );

  return totalRefundedAmountUSDByAddress;
}

export async function getLatestEpochProcessed(
  chainId: number,
): Promise<number> {
  return GasRefundParticipation.max<number, GasRefundParticipation>('epoch', {
    where: {
      chainId,
    },
  });
}

export async function getLatestTransactionTimestamp() {
  const chainToTxTimestamp = (await GasRefundTransaction.findAll({
    attributes: [
      'chainId',
      [
        Sequelize.fn('max', Sequelize.col('timestamp')),
        'lastTimestampForChain',
      ],
    ],
    group: 'chainId',
    raw: true,
  })) as unknown as { chainId: number; lastTimestampForChain: number }[];

  const lastTxTimestampsAllChains = chainToTxTimestamp.map(
    t => t.lastTimestampForChain,
  );

  // if we didn't get exact same number as supported chains
  // it might be due to data of one chain not being computed yet
  // in such case prefer returning 0 and fallback to GasRefundGensisStartTime
  if (lastTxTimestampsAllChains.length !== GRP_SUPPORTED_CHAINS.length)
    return 0;

  const latestTransactionTimestamp = Math.min(...lastTxTimestampsAllChains);

  return latestTransactionTimestamp;
}

export const writeTransactions = async (
  pendingEpochGasRefundData: GasRefundTransactionData[],
) => {
  await GasRefundTransaction.bulkCreate(pendingEpochGasRefundData);
};

export const merkleRootExists = async ({
  chainId,
  epoch,
}: {
  chainId: number;
  epoch: number;
}): Promise<boolean> => {
  const existingGasRefundDistributionEntry =
    await GasRefundDistribution.findOne({
      where: { chainId, epoch },
    });

  return !!existingGasRefundDistributionEntry;
};

export const saveMerkleTreeInDB = async ({
  chainId,
  epoch,
  merkleTree,
}: {
  epoch: number;
  chainId: number;
  merkleTree: MerkleTreeData;
}): Promise<void> => {
  const {
    root: { totalAmount, merkleRoot },
    leaves,
  } = merkleTree;

  const epochDataToUpdate: GasRefundParticipantData[] = leaves.map(
    (leaf: MerkleData) => ({
      epoch,
      address: leaf.address,
      chainId: chainId,

      merkleProofs: leaf.merkleProofs,
      isCompleted: true,
    }),
  );

  const bulkUpdateParticipations = async (
    participantsToUpdate: GasRefundParticipantData[],
  ) => {
    await GasRefundParticipation.bulkCreate(participantsToUpdate, {
      updateOnDuplicate: ['merkleProofs', 'isCompleted'],
    });
  };

  await Promise.all(
    sliceCalls({
      inputArray: epochDataToUpdate,
      execute: bulkUpdateParticipations,
      sliceLength: 100,
    }),
  );

  await GasRefundDistribution.create({
    epoch,
    chainId,
    totalPSPAmountToRefund: totalAmount,
    merkleRoot,
  });
};
