import {
  CompletedEpochGasRefundData,
  GRP_SUPPORTED_CHAINS,
  PendingEpochGasRefundData,
} from '../../../src/lib/gas-refund';
import { GasRefundParticipation } from '../../../src/models/GasRefundParticipation';
import { GasRefundDistribution } from '../../../src/models/GasRefundDistribution';
import { MerkleData, MerkleTreeData, TxFeesByAddress } from '../types';
import { sliceCalls } from '../utils';
import { Sequelize } from 'sequelize';
import BigNumber from 'bignumber.js';

export const fetchPendingGasRefundData = async ({
  chainId,
  epoch,
}: {
  chainId: number;
  epoch: number;
}): Promise<TxFeesByAddress> => {
  const pendingEpochData = (await GasRefundParticipation.findAll({
    where: { chainId, epoch },
    raw: true,
  })) as PendingEpochGasRefundData[];

  const pendingEpochDataByAddress = pendingEpochData.reduce<TxFeesByAddress>(
    (acc, curr) => {
      acc[curr.address] = curr;
      return acc;
    },
    {},
  );

  return pendingEpochDataByAddress;
};

export async function fetchVeryLastTimestampProcessed({
  chainId,
  epoch,
}: {
  chainId: number;
  epoch: number;
}): Promise<number> {
  const lastTimestamp = await GasRefundParticipation.max<
    number,
    GasRefundParticipation
  >('lastTimestamp', {
    where: { chainId, epoch },
  });

  return lastTimestamp;
}

export async function fetchTotalRefundedPSP(): Promise<BigNumber> {
  const totalPSPRefunded = await GasRefundParticipation.sum<
    string,
    GasRefundParticipation
  >('refundedAmountPSP');

  return new BigNumber(totalPSPRefunded);
}

export async function fetchTotalRefundedAmountUSDByAddress(): Promise<{
  [address: string]: BigNumber;
}> {
  const totalRefundedAmountUSDAllAddresses =
    (await GasRefundParticipation.findAll({
      attributes: [
        'address',
        [
          Sequelize.fn('SUM', Sequelize.col('refundedAmountUSD')),
          'totalRefundedAmountUSD',
        ],
      ],
      group: 'address',
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
      isCompleted: false,
      chainId,
    },
  });
}

export async function getLatestTransactionTimestamp() {
  const chainToTxTimestamp = (await GasRefundParticipation.findAll({
    attributes: [
      'chainId',
      [
        Sequelize.fn('max', Sequelize.col('lastTimestamp')),
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

export const writePendingEpochData = async (
  pendingEpochGasRefundData: PendingEpochGasRefundData[],
) => {
  await GasRefundParticipation.bulkCreate(pendingEpochGasRefundData, {
    updateOnDuplicate: [
      'accumulatedGasUsedPSP',
      'accumulatedGasUsed',
      'accumulatedGasUsedChainCurrency',
      'accumulatedGasUsedUSD',
      'firstBlock',
      'lastBlock',
      'firstTimestamp',
      'lastTimestamp',
      'firstTx',
      'lastTx',
      'numTx',
      'isCompleted',
      'totalStakeAmountPSP',
      'refundedAmountPSP',
      'refundedAmountUSD',
    ],
  });
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

  const epochDataToUpdate: CompletedEpochGasRefundData[] = leaves.map(
    (leaf: MerkleData) => ({
      epoch,
      address: leaf.address,
      chainId: chainId,

      merkleProofs: leaf.merkleProofs,
      isCompleted: true,
    }),
  );

  const bulkUpdateParticipations = async (
    participantsToUpdate: CompletedEpochGasRefundData[],
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
