import BigNumber from 'bignumber.js';
import { Op, Sequelize } from 'sequelize';
import { assert } from 'ts-essentials';
import {
  CHAIN_ID_MAINNET,
  CHAIN_ID_OPTIMISM,
} from '../../../src/lib/constants';
import {
  GRP_SUPPORTED_CHAINS,
  GasRefundTransactionData,
  GasRefundV2EpochOptimismFlip,
  TransactionStatus,
} from '../../../src/lib/gas-refund/gas-refund';
import { GasRefundDistribution } from '../../../src/models/GasRefundDistribution';
import { GasRefundTransaction } from '../../../src/models/GasRefundTransaction';
import {
  GasRefundTransactionStakeSnapshot,
  GasRefundTransactionStakeSnapshotData,
} from '../../../src/models/GasRefundTransactionStakeSnapshot';
import {
  StakedScoreV1,
  StakedScoreV2,
  isStakeScoreV2,
} from '../staking/stakes-tracker';

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

export async function loadLastEthereumDistributionFromDb() {
  const lastRefundedEpochOnMainnet = await getLatestEpochRefunded(
    CHAIN_ID_MAINNET,
  );
  const lastMultichainDistribution =
    lastRefundedEpochOnMainnet > GasRefundV2EpochOptimismFlip
      ? lastRefundedEpochOnMainnet
      : undefined;

  return lastMultichainDistribution;
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
    group: 'chainId',
    raw: true,
  })) as unknown as { chainId: number; lastEpoch: number }[];

  const lastEpochRefunded = chainToEpoch.reduce(
    (max, curr) => Math.max(max, curr.lastEpoch),
    0,
  );

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
  for (const transaction of newRefundableTransactions) {
    try {
      await GasRefundTransaction.create(transaction);
      console.log(`Transaction created: ${JSON.stringify(transaction)}`);
    } catch (error) {
      console.error(
        `Error creating transaction: ${JSON.stringify(transaction)}`,
        error,
      );
      throw error;
    }
  }
  // await GasRefundTransaction.bulkCreate(newRefundableTransactions);
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

export function composeGasRefundTransactionStakeSnapshots(
  transaction: GasRefundTransactionData,
  stakeScore: StakedScoreV1 | StakedScoreV2,
): GasRefundTransactionStakeSnapshotData[] {
  if (isStakeScoreV2(stakeScore)) {
    return Object.entries(stakeScore.byNetwork).map(([chainId, score]) => ({
      transactionChainId: transaction.chainId,
      transactionHash: transaction.hash,
      stakeChainId: Number(chainId),
      stakeScore: score?.stakeScore || '0',
      sePSP1Balance: score?.sePSP1Balance || '0',
      sePSP2Balance: score?.sePSP2Balance || '0',
      bptTotalSupply: score?.bptTotalSupply || '0',
      bptPSPBalance: score?.bptPSPBalance || '0',
      claimableSePSP1Balance: score?.claimableSePSP1Balance || '0',
      staker: transaction.address,
    }));
  }
  return [];
}

export async function writeStakeScoreSnapshots(
  items: GasRefundTransactionStakeSnapshotData[],
) {
  const indices = items.map(item => Object.values(item).join(','));
  const unique = new Set<string>(indices);
  if (unique.size !== items.length) {
    // throw new Error('Duplicated items in stake score snapshots');

    const dupes = indices.filter(
      (item, index) => indices.indexOf(item) != index,
    );
    debugger;
    throw new Error(`Duplicated items in stake score snapshots: ${dupes}`);
  }

  for (const item of items) {
    try {
      await GasRefundTransactionStakeSnapshot.create(item);
      console.log(`Snapshot created or updated: ${JSON.stringify(item)}`);
    } catch (error) {
      console.error(
        `Error creating or updating snapshot: ${JSON.stringify(item)}`,
        error,
      );
    }
  }

  // return GasRefundTransactionStakeSnapshot.bulkCreate(items, {
  //   updateOnDuplicate: ['stakeScore'],
  // });
}

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
