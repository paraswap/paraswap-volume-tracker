import { GasRefundParticipant } from '../../../src/models/GasRefundParticipant';
import { GasRefundProgram } from '../../../src/models/GasRefundProgram';
import {
  MerkleData,
  MerkleTreeData,
  CompletedEpochGasRefundData,
  PendingEpochGasRefundData,
  TxFeesByAddress,
  StakedPSPByAddress,
} from '../types';

const fetchPendingEpochData = async ({
  chainId,
  epoch,
}: {
  chainId: number;
  epoch: number;
}): Promise<TxFeesByAddress> => {
  const pendingEpochData = (await GasRefundParticipant.findAll({
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

async function fetchVeryLastBlockNumProcessed({
  chainId,
  epoch,
}: {
  chainId: number;
  epoch: number;
}): Promise<number> {
  const lastBlockNum = await GasRefundParticipant.max('lastBlockNum', {
    where: { chainId, epoch },
  });

  return lastBlockNum as number;
}

export const readPendingEpochData = async ({
  chainId,
  epoch,
}: {
  chainId: number;
  epoch: number;
}): Promise<[TxFeesByAddress, number]> => {
  return Promise.all([
    fetchPendingEpochData({ chainId, epoch }),
    fetchVeryLastBlockNumProcessed({ chainId, epoch }),
  ]);
};

export const writePendingEpochData = async (
  pendingEpochGasRefundData: PendingEpochGasRefundData[],
) => {
  await GasRefundParticipant.bulkCreate(pendingEpochGasRefundData, {
    updateOnDuplicate: [
      'accumulatedGasUsedPSP',
      'accumulatedGasUsed',
      'lastBlockNum',
      'isCompleted',
    ],
  });
};

// @FIXME: slice DB writes
export const writeCompletedEpochData = async (
  chainId: number,
  merkleTree: MerkleTreeData | null,
  pspStakesByAddress: StakedPSPByAddress,
) => {
  if (!merkleTree) {
    return [];
  }
  const {
    root: { epoch, totalAmount, merkleRoot },
    leaves,
  } = merkleTree;

  const epochDataToUpdate: CompletedEpochGasRefundData[] = leaves.map(
    (leaf: MerkleData) => ({
      epoch,
      address: leaf.address,
      chainId: chainId,

      totalStakeAmountPSP: pspStakesByAddress[leaf.address],
      refundedAmountPSP: leaf.amount,
      merkleProofs: leaf.merkleProofs,
      isCompleted: true,
    }),
  );

  // todo: bulk upsert epoch data once models are defined
  for (let i = 0; i < epochDataToUpdate.length; i++) {
    const endEpochData = epochDataToUpdate[i];

    // key
    const { epoch, address, chainId } = endEpochData;

    await GasRefundParticipant.update(endEpochData, {
      where: { epoch, address, chainId },
    });
  }

  await GasRefundProgram.create({
    epoch,
    chainId,
    totalPSPAmountToRefund: totalAmount,
    merkleRoot,
  });
};
