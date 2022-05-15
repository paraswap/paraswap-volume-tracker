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
import { Sequelize, Op } from 'sequelize';
import BigNumber from 'bignumber.js';
import { assert } from 'ts-essentials';

export async function fetchLastTimestampTxByContract({
  chainId,
  epoch,
}: {
  chainId: number;
  epoch: number;
}): Promise<{ [contract: string]: number }> {
  const totalRefundedAmountUSDAllAddresses =
    (await GasRefundTransaction.findAll({
      attributes: [
        'contract',
        [Sequelize.fn('MAX', Sequelize.col('timestamp')), 'latestTimestamp'],
      ],
      where: {
        chainId,
        epoch,
      },
      group: 'contract',
      raw: true,
    })) as unknown as { contract: string; latestTimestamp: number }[];

  return Object.fromEntries(
    totalRefundedAmountUSDAllAddresses.map(
      ({ contract, latestTimestamp }) => [contract, latestTimestamp] as const,
    ),
  );
}

export async function fetchTotalRefundedPSP(
  toEpoch?: number,
): Promise<BigNumber> {
  const totalPSPRefunded = await GasRefundTransaction.sum<
    string,
    GasRefundTransaction
  >('refundedAmountPSP', {
    where: {
      status: TransactionStatus.VALIDATED,
      ...(toEpoch ? { epoch: { [Op.lt]: toEpoch } } : {}),
    },
    dataType: 'string',
  });

  return new BigNumber(totalPSPRefunded);
}

export async function fetchTotalRefundedAmountUSDByAddress(
  toEpoch?: number,
): Promise<{
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
        ...(toEpoch ? { epoch: { [Op.lt]: toEpoch } } : {}),
      },
      group: 'address',
      raw: true,
    })) as unknown as { address: string; totalRefundedAmountUSD: string }[];

  const totalRefundedAmountUSDByAddress = Object.fromEntries(
    totalRefundedAmountUSDAllAddresses.map(
      ({ address, totalRefundedAmountUSD }) =>
        [address, new BigNumber(totalRefundedAmountUSD)] as const,
    ),
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

export async function fetchLastEpochRefunded(): Promise<number | undefined> {
  const chainToEpoch = (await GasRefundDistribution.findAll({
    attributes: [
      'chainId',
      [Sequelize.fn('max', Sequelize.col('epoch')), 'lastEpoch'],
    ],
    group: 'chainId',
    raw: true,
  })) as unknown as { chainId: number; lastEpoch: number }[];

  const lastEpochRefunded = chainToEpoch?.[0]?.lastEpoch;

  assert(
    chainToEpoch.every(t => t.lastEpoch === lastEpochRefunded),
    'should compute merkle data of all chains at same time to not skew validation step',
  );

  return lastEpochRefunded;
}

export const writeTransactions = async (
  newRefundableTransactions: GasRefundTransactionData[],
) => {
  await GasRefundTransaction.bulkCreate(newRefundableTransactions);
};

export const updateTransactionsStatusRefundedAmounts = async (
  transactionsWithNewStatus: GasRefundTransactionData[],
) => {
  await GasRefundTransaction.bulkCreate(transactionsWithNewStatus, {
    updateOnDuplicate: ['status', 'refundedAmountUSD', 'refundedAmountPSP'],
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
