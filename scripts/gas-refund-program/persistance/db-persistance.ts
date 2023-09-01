import {
  GRP_SUPPORTED_CHAINS,
  GasRefundTransactionData,
  GasRefundParticipantData,
  TransactionStatus,
  GasRefundV2EpochOptimismFlip,
} from '../../../src/lib/gas-refund/gas-refund';
import { GasRefundParticipation } from '../../../src/models/GasRefundParticipation';
import { GasRefundTransaction } from '../../../src/models/GasRefundTransaction';
import { GasRefundDistribution } from '../../../src/models/GasRefundDistribution';
import {AddressRewardsMapping, MerkleData, MerkleTreeData} from '../types';
import { Sequelize, Op } from 'sequelize';
import BigNumber from 'bignumber.js';
import { assert } from 'ts-essentials';
import { sliceCalls } from '../../../src/lib/utils/helpers';
import { CHAIN_ID_FANTOM, CHAIN_ID_OPTIMISM } from '../../../src/lib/constants';

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
  startEpoch: number,
  toEpoch?: number,
): Promise<BigNumber> {
  const totalPSPRefunded = (await GasRefundTransaction.sum<
    string,
    GasRefundTransaction
  >('refundedAmountPSP', {
    where: {
      status: TransactionStatus.VALIDATED,
      epoch: {
        [Op.gte]: startEpoch,
        ...(toEpoch ? { [Op.lt]: toEpoch } : {}),
      },
    },
    dataType: 'string',
  })) as unknown as string | number; // wrong type

  return new BigNumber(totalPSPRefunded);
}

export async function fetchTotalRefundedAmountUSDByAddress(
  startEpoch: number,
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
        epoch: {
          [Op.gte]: startEpoch,
          ...(toEpoch ? { [Op.lt]: toEpoch } : {}),
        },
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

export async function getLatestEpochRefunded(chainId: number): Promise<number> {
  return GasRefundDistribution.max<number, GasRefundDistribution>('epoch', {
    where: {
      chainId,
    },
  });
}

export async function getLatestEpochRefundedAllChains() {
  const chainToEpoch = (await GasRefundDistribution.findAll({
    attributes: [
      'chainId',
      [Sequelize.fn('max', Sequelize.col('epoch')), 'latestEpochRefunded'],
    ],
    group: 'chainId',
    raw: true,
  })) as unknown as { chainId: number; latestEpochRefunded: number }[];

  const _chainToEpoch = chainToEpoch.find(t => t.chainId === CHAIN_ID_OPTIMISM)
    ? chainToEpoch
    : chainToEpoch.concat({
        // ugly fix to prevent having new chains breaking logi
        chainId: CHAIN_ID_OPTIMISM,
        latestEpochRefunded: GasRefundV2EpochOptimismFlip - 1,
      });

  const latestEpochsRefunded = _chainToEpoch.map(t => t.latestEpochRefunded);

  // if we didn't get exact same number as supported chains
  // it might be due to data of one chain not being computed yet
  // in such case prefer return undefined and let upper layer decide
  if (latestEpochsRefunded.length !== GRP_SUPPORTED_CHAINS.length) return;

  const latestEpochRefunded = Math.min(...latestEpochsRefunded);

  return latestEpochRefunded;
}

export async function fetchLastEpochRefunded(
  skipValidation = true,
): Promise<number | undefined> {
  const chainToEpoch = (await GasRefundDistribution.findAll({
    attributes: [
      'chainId',
      [Sequelize.fn('max', Sequelize.col('epoch')), 'lastEpoch'],
    ],
    where: {
      chainId: {
        [Op.not]: CHAIN_ID_FANTOM,
      },
    },
    group: 'chainId',
    raw: true,
  })) as unknown as { chainId: number; lastEpoch: number }[];

  const lastEpochRefunded = chainToEpoch.reduce(
    (max, curr) => Math.max(max, curr.lastEpoch),
    0,
  );

  // debugger;

  if (!skipValidation) {
    assert(
      chainToEpoch.every(t => t.lastEpoch === lastEpochRefunded),
      'should compute merkle data of all chains at same time to not skew validation step',
    );
  }

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
    updateOnDuplicate: [
      'status',
      'refundedAmountUSD',
      'refundedAmountPSP',
      'paraBoostFactor',
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
  userGRPChainsBreakDowns
}: {
  epoch: number;
  chainId: number;
  merkleTree: MerkleTreeData;
  userGRPChainsBreakDowns: AddressRewardsMapping;
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
      GRPChainBreakDown: userGRPChainsBreakDowns[leaf.address]
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
