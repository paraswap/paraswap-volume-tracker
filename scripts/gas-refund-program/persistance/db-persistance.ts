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
import { sliceCalls } from '../utils'

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
): Promise<void> => {
  if (!merkleTree) {
    return;
  }
  const {
    root: { epoch, totalAmount, merkleRoot },
    leaves,
  } = merkleTree;


  const existingGasRefundProgramEntry = await GasRefundProgram.findOne({ where: { chainId, epoch }})
  if (existingGasRefundProgramEntry) {
    return;
  }

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

  const bulkUpdateParticipants = async (participantsToUpdate: CompletedEpochGasRefundData[]) => {
    await GasRefundParticipant.bulkCreate(participantsToUpdate, {
      updateOnDuplicate: [
        'totalStakeAmountPSP',
        'refundedAmountPSP',
        // todo: fix this: model inference not working
        // @ts-ignore
        'merkleProofs',
        'isCompleted',
      ],
    });
  }

  await Promise.all(sliceCalls({ inputArray: epochDataToUpdate, execute: bulkUpdateParticipants, sliceLength: 100 }))

  await GasRefundProgram.create({
    epoch,
    chainId,
    totalPSPAmountToRefund: totalAmount,
    merkleRoot,
  });
};
