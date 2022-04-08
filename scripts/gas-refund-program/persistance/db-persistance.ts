import {
  CompletedEpochGasRefundData,
  PendingEpochGasRefundData,
} from '../../../src/lib/gas-refund';
import { GasRefundParticipation } from '../../../src/models/GasRefundParticipation';
import { GasRefundDistribution } from '../../../src/models/GasRefundDistribution';
import { MerkleData, MerkleTreeData, TxFeesByAddress } from '../types';
import { sliceCalls } from '../utils';

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

export const writePendingEpochData = async (
  pendingEpochGasRefundData: PendingEpochGasRefundData[],
) => {
  await GasRefundParticipation.bulkCreate(pendingEpochGasRefundData, {
    updateOnDuplicate: [
      'accumulatedGasUsedPSP',
      'accumulatedGasUsed',
      'accumulatedGasUsedChainCurrency',
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
