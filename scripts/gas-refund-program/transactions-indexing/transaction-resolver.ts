/**
 * this file resolves transactions.
 * it is agnostic to sources, and works with both the graph and covalent.
 * it is also agnostic to chagnes introduced at certain epochs.
 * it bridges the gap between different sources, to ensure the same data
 * is returned either way. for example querying for swaps: the data will
 * come from subgraph before a certain epoch, and so gets augmented
 * with gas used data, whereas later we use covalent which has this already.
 *
 * the caller of functions in this util don't need to care about how the data
 * is resolved, that is the response of the code in this file.
 */
import { SPSPAddresses } from '../../../src/lib/staking/spsp-helper';
import { covalentGetTXsForContractV3 } from './txs-covalent';
import { getTransactionGasUsed } from '../../../src/lib/utils/covalent';
import StakesTracker from '../staking/stakes-tracker';
import { getSuccessfulSwaps } from './swaps-subgraph';
import { GasRefundTransaction } from '../types';
import {
  GasRefundConsiderContractTXsStartEpoch,
  GasRefundV2EpochFlip,
  GasRefundV2EpochOptimismFlip,
  getMinStake,
  isMainnetStaking,
} from '../../../src/lib/gas-refund/gas-refund';
import {
  CHAIN_ID_MAINNET,
  CHAIN_ID_GOERLI,
  SAFETY_MODULE_ADDRESS,
  AUGUSTUS_V5_ADDRESS,
  CHAIN_ID_OPTIMISM,
  AugustusV5Address,
  CHAIN_ID_FANTOM,
} from '../../../src/lib/constants';
import { getMigrationsTxs } from '../staking/2.0/migrations';
import { MIGRATION_SEPSP2_100_PERCENT_KEY } from '../staking/2.0/utils';
import { grp2ConfigByChain } from '../../../src/lib/gas-refund/config';
import { assert } from 'ts-essentials';

type GetAllTXsInput = {
  startTimestamp: number;
  endTimestamp: number;
  chainId: number;
  epoch: number;
  epochEndTimestamp: number;
  contractAddress: string;
};

const StakingV1ContractAddressByChain: Record<number, string[]> = {
  [CHAIN_ID_MAINNET]: [...SPSPAddresses, SAFETY_MODULE_ADDRESS],
};

const contractAddressesByChain: Record<number, string[]> = {
  [CHAIN_ID_MAINNET]: [
    ...(isMainnetStaking
      ? [
          MIGRATION_SEPSP2_100_PERCENT_KEY,
          grp2ConfigByChain[CHAIN_ID_MAINNET]?.sePSP1,
          grp2ConfigByChain[CHAIN_ID_MAINNET]?.sePSP2,
          grp2ConfigByChain[CHAIN_ID_MAINNET]?.sePSP1ToSePSP2Migrator,
        ]
      : []),
    AUGUSTUS_V5_ADDRESS,
  ],
  [CHAIN_ID_GOERLI]: [
    MIGRATION_SEPSP2_100_PERCENT_KEY,
    grp2ConfigByChain[CHAIN_ID_GOERLI].sePSP1,
    grp2ConfigByChain[CHAIN_ID_GOERLI].sePSP2,
  ],
  [CHAIN_ID_OPTIMISM]: [
    grp2ConfigByChain[CHAIN_ID_OPTIMISM]?.sePSP1,
    grp2ConfigByChain[CHAIN_ID_OPTIMISM]?.sePSP2,
    grp2ConfigByChain[CHAIN_ID_OPTIMISM]?.sePSP1ToSePSP2Migrator,
    AUGUSTUS_V5_ADDRESS,
  ],
};

export const getContractAddresses = ({
  chainId,
  epoch,
}: {
  chainId: number;
  epoch: number;
}) => {
  if (chainId == CHAIN_ID_OPTIMISM && epoch < GasRefundV2EpochOptimismFlip) {
    return [];
  }

  if (epoch < GasRefundConsiderContractTXsStartEpoch)
    return [AUGUSTUS_V5_ADDRESS];

  if (epoch < GasRefundV2EpochFlip) {
    return (StakingV1ContractAddressByChain[chainId] || []).concat(
      AUGUSTUS_V5_ADDRESS,
    );
  }

  return contractAddressesByChain[chainId] ?? [AUGUSTUS_V5_ADDRESS];
};

export const getAllTXs = async ({
  epoch,
  chainId,
  startTimestamp,
  endTimestamp,
  epochEndTimestamp,
  contractAddress,
}: GetAllTXsInput): Promise<GasRefundTransaction[]> => {
  // fetch swaps and contract (staking pools, safety module) txs
  if (contractAddress === AUGUSTUS_V5_ADDRESS && chainId !== CHAIN_ID_OPTIMISM)
    return getSwapTXs({
      epoch,
      chainId,
      startTimestamp,
      endTimestamp,
      epochEndTimestamp,
    });

  if (contractAddress === MIGRATION_SEPSP2_100_PERCENT_KEY) {
    return getMigrationsTxs({
      epoch,
      chainId,
      startTimestamp,
      endTimestamp,
    });
  }

  return getTransactionForContract({
    epoch,
    chainId,
    startTimestamp,
    endTimestamp,
    contractAddress,
  });
};

/**
 * this will take an epoch, a chain, and two timespan values (min/max).
 * it will use subgraph for now (and augment gas data via a covalent call),
 * but later resolve to covalent after a certain epoch.
 */
type GetSwapTXsInput = {
  epoch: number;
  chainId: number;
  startTimestamp: number;
  endTimestamp: number;
  epochEndTimestamp: number;
};
export const getSwapTXs = async ({
  epoch,
  chainId,
  startTimestamp,
  endTimestamp,
  epochEndTimestamp,
}: GetSwapTXsInput): Promise<GasRefundTransaction[]> => {
  // get swaps from the graph
  const swaps = await getSuccessfulSwaps({
    startTimestamp,
    endTimestamp,
    chainId,
    epoch,
  });

  // check the swapper is a staker, and likewise hasn't used up their budget, to avoid subsequently wasting resources looking up gas unnecessarily
  const swapsOfQualifyingStakers = swaps.filter(swap => {
    const swapperStake = StakesTracker.getInstance().computeStakeScore(
      swap.txOrigin,
      +swap.timestamp,
      epoch,
      epochEndTimestamp,
    );
    // tx address must be a staker && must not be over their budget in order to be processed
    return swapperStake.combined.isGreaterThanOrEqualTo(getMinStake(epoch));
  });

  const allTxsWithGas = await covalentGetTXsForContractV3({
    startTimestamp,
    endTimestamp,
    chainId,
    contract: AugustusV5Address[chainId],
  });

  const txHashToGas = allTxsWithGas.reduce<Record<string, string>>(
    (acc, curr) => {
      acc[curr.txHash.toLowerCase()] = curr.txGasUsed;
      return acc;
    },
    {},
  );

  const _getTransactionGasUsedSync = ({
    chainId,
    txHash,
  }: {
    chainId: number;
    txHash: string;
  }) => {
    const txGasUsed = txHashToGas[txHash.toLowerCase()];

    assert(
      txGasUsed,
      `gas used should not be zero for ${txHash} on chainId=${chainId}`,
    );

    return txGasUsed;
  };

  // augment with gas used and the pertaining contract the tx occured on
  const swapsWithGasUsedNormalised: GasRefundTransaction[] =
    swapsOfQualifyingStakers.map(
      ({ txHash, txOrigin, txGasPrice, timestamp, blockNumber }) => {
        const txGasUsed = _getTransactionGasUsedSync({
          chainId,
          txHash,
        });

        return {
          txHash,
          txOrigin,
          txGasPrice,
          timestamp,
          blockNumber,
          txGasUsed: txGasUsed.toString(),
          contract: AUGUSTUS_V5_ADDRESS,
        };
      },
    );
  return swapsWithGasUsedNormalised;
};

/**
 * staking and unstaking txs.
 * call covalent and get all txs within a period for a staking contract. do this
 * for all staking contracts.
 */
type GetContractsTXsInput = {
  epoch: number;
  chainId: number;
  startTimestamp: number;
  endTimestamp: number;
  contractAddress: string;
};
export const getTransactionForContract = async ({
  epoch,
  startTimestamp,
  endTimestamp,
  chainId,
  contractAddress,
}: GetContractsTXsInput): Promise<GasRefundTransaction[]> => {
  // fail fast if this is a deadend
  if (epoch < GasRefundConsiderContractTXsStartEpoch) {
    return [];
  }

  const txsFromAllContracts = (await covalentGetTXsForContractV3({
    startTimestamp,
    endTimestamp,
    chainId,
    contract: contractAddress,
  })) as unknown as GasRefundTransaction[];

  return txsFromAllContracts;
};
