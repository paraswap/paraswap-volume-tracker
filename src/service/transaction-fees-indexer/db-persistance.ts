import { EpochGasRefund } from '../../models/EpochGasRefund';
import {
  MerkleData,
  MerkleTreeData,
  PSPStakesByAddress,
  CompletedEpochGasRefundData,
  PendingEpochGasRefundData,
} from './types';

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
