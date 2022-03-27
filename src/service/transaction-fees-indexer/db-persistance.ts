import { EpochGasRefund } from '../../models/EpochGasRefund';
import {
  MerkleData,
  MerkleTreeData,
  PSPStakesByAddress,
  CompletedEpochGasRefundData,
  PendingEpochGasRefundData,
  TxFeesByAddress,
} from './types';

const fetchPendingEpochData = async ({
  chainId,
  epoch,
}: {
  chainId: number;
  epoch: number;
}): Promise<TxFeesByAddress> => {
  const pendingEpochData = (await EpochGasRefund.findAll({
    where: { chainId, epoch },
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
  const lastBlockNum = await EpochGasRefund.max('lastBlockNum', {
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
  await EpochGasRefund.bulkCreate(pendingEpochGasRefundData, {
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
  pspStakesByAddress: PSPStakesByAddress,
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

      totalStakeAmountPSP: pspStakesByAddress[leaf.address].toFixed(0),
      refundedAmountPSP: totalAmount,
      merkleProofs: leaf.merkleProofs,
      merkleRoot,
      isCompleted: true,
    }),
  );

  // todo: bulk upsert epoch data once models are defined
  for (let i = 0; i < epochDataToUpdate.length; i++) {
    const endEpochData = epochDataToUpdate[i];

    // key
    const { epoch, address, chainId } = endEpochData;

    await EpochGasRefund.update(endEpochData, {
      where: { epoch, address, chainId },
    });
  }
};
