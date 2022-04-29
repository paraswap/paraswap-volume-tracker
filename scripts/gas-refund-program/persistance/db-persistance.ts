import {
  CompletedEpochGasRefundData,
  PendingEpochGasRefundData,
  GasRefundTransactionData,
  GasRefundParticipantData
} from '../../../src/lib/gas-refund';
import { GasRefundParticipation } from '../../../src/models/GasRefundParticipation';
import { GasRefundTransaction } from '../../../src/models/GasRefundTransaction';
import { GasRefundDistribution } from '../../../src/models/GasRefundDistribution';
import { MerkleData, MerkleTreeData, TxFeesByAddress } from '../types';
import { sliceCalls } from '../utils';
import { Sequelize } from 'sequelize';
import BigNumber from 'bignumber.js';


// todo: obsolete now? think I removed it
export const fetchEpochAddressesProcessedCount = async ({chainId, epoch}: {
  chainId: number;
  epoch: number;
}): Promise<number> => {

  const count = await GasRefundTransaction.count({
    distinct: true,
    col: 'hash',
    where: { chainId, epoch }
  });
  return count
}

export const fetchPendingGasRefundData = async ({
  chainId,
  epoch,
}: {
  chainId: number;
  epoch: number;
}): Promise<TxFeesByAddress> => {
  const pendingEpochData = (await GasRefundTransaction.findAll({
    where: { chainId, epoch },
    raw: true,
  })) as GasRefundTransactionData[];

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
  >('refundedAmountPSP');

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

export const writePendingEpochData = async (
  pendingEpochGasRefundData: GasRefundTransactionData[],
) => {
  /**
   * todo: this comment is redundant now
   * ignore duplicates for cases like
   * https://etherscan.io/tx/0xb10c51756678cb6cb1635ac339f9caa592f49ea6da936b109dbd49da8e0e0a6a
   * where the graph returns three swaps for one tx, resulting
   * in gas being fetched three times for one tx. only an issue while
   * we get swaps not txs.
   */
   await GasRefundTransaction.bulkCreate(pendingEpochGasRefundData, { ignoreDuplicates: true });
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
  addressRefundedAmountPSP,
}: {
  epoch: number;
  chainId: number;
  merkleTree: MerkleTreeData;
  addressRefundedAmountPSP: Record<string, BigNumber>;
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
      refundedAmountPSP: addressRefundedAmountPSP[leaf.address].toFixed(0),
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

export const fetchTransactionOccurences = async (epoch: number, chainId: number): Promise<Record<string, number>> => {
  const txOccurences: Record<string, number> = {}
  const txs: Pick<GasRefundTransactionData, 'hash' | 'occurence'>[] = await GasRefundTransaction.findAll({
    where: { chainId, epoch },
    attributes: ['hash', 'occurenc']
  })
  txs.forEach((tx) => {
    txOccurences[tx.hash] = tx.occurence
  })
  return txOccurences
}
