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
import {
  constructCovalentAddressToTransaction,
  covalentGetTXsForContractV3,
  duneToCovalentLike,
} from './txs-covalent';
import StakesTracker from '../staking/stakes-tracker';
import { getSuccessfulSwaps } from './swaps-subgraph';
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
} from '../../../src/lib/constants';
import { getMigrationsTxs } from '../staking/2.0/migrations';
import { MIGRATION_SEPSP2_100_PERCENT_KEY } from '../staking/2.0/utils';
import { grp2ConfigByChain } from '../../../src/lib/gas-refund/config';
import { assert } from 'ts-essentials';
import { DuneTransaction } from '../../../src/models/DuneTransaction';
import { Op } from 'sequelize';
import { fetchTxGasUsed } from '../../../src/lib/fetch-tx-gas-used';
import { ExtendedCovalentGasRefundTransaction } from '../../../src/types-from-scripts';

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
    MIGRATION_SEPSP2_100_PERCENT_KEY,
    grp2ConfigByChain[CHAIN_ID_MAINNET]?.sePSP1,
    grp2ConfigByChain[CHAIN_ID_MAINNET]?.sePSP2,
    grp2ConfigByChain[CHAIN_ID_MAINNET]?.sePSP1ToSePSP2Migrator,
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

  const result = contractAddressesByChain[chainId] ?? [AUGUSTUS_V5_ADDRESS];

  const withoutDelta = [
    ...result,
    '0x00000000FdAC7708D0D360BDDc1bc7d097F47439'.toLowerCase(), // augustus 6.0
    '0x000db803a70511e09da650d4c0506d0000100000'.toLowerCase(), // augustus 6.1
  ];

  // IMPORTANT: THIS DIFF WAS MISSING WHEN I WAS CHECKING AGAINST OLD CODE -> FOUND BUG THIS WAY
  // return chainId == 1
  //   ? withoutDelta
  //   :
  return withoutDelta.concat(
    '0x6a000f20005980200259b80c5102003040001068'.toLowerCase(),
  ); // augustus 6.2 -> with delta
};

export const getAllTXs = async ({
  epoch,
  chainId,
  startTimestamp,
  endTimestamp,
  epochEndTimestamp,
  contractAddress,
}: GetAllTXsInput): Promise<ExtendedCovalentGasRefundTransaction[]> => {
  // fetch swaps and contract (staking pools, safety module) txs
  if (
    contractAddress === AUGUSTUS_V5_ADDRESS &&
    chainId !== CHAIN_ID_OPTIMISM
  ) {
    const swapTxs = (
      await DuneTransaction.findAll({
        where: {
          chainId,
          to: contractAddress,
          block_timestamp: {
            [Op.gt]: startTimestamp,
            [Op.lte]: endTimestamp,
          },
          success: true,
        },
      })
    )
      .map(duneToCovalentLike)
      .map(constructCovalentAddressToTransaction(contractAddress, chainId));
    return swapTxs;
  }

  if (contractAddress === MIGRATION_SEPSP2_100_PERCENT_KEY) {
    return getMigrationsTxs({
      epoch,
      chainId,
      startTimestamp,
      endTimestamp,
    });
  }

  const filteredTxs = (
    await DuneTransaction.findAll({
      where: {
        chainId,
        to: contractAddress,
        block_timestamp: {
          [Op.gt]: startTimestamp,
          [Op.lte]: endTimestamp,
        },
      },
    })
  )
    .map(duneToCovalentLike)
    .map(constructCovalentAddressToTransaction(contractAddress, chainId));

  return filteredTxs;
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

// not used if replaced by dune
const getSwapTXs = async ({
  epoch,
  chainId,
  startTimestamp,
  endTimestamp,
  epochEndTimestamp,
}: GetSwapTXsInput): Promise<ExtendedCovalentGasRefundTransaction[]> => {
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

  // reminder: as our subgraphs were not updated since gasUsd not gasUsed the graph issue has been fixed (https://github.com/graphprotocol/graph-node/issues/2619) we need to fetch gasUsed separately
  const swapsWithGasUsedNormalised: ExtendedCovalentGasRefundTransaction[] =
    await Promise.all(
      swapsOfQualifyingStakers.map(
        async ({ txHash, txOrigin, txGasPrice, timestamp, blockNumber }) => {
          const { gasUsed: txGasUsed } = await fetchTxGasUsed(chainId, txHash);

          assert(
            txGasUsed,
            `gas used should not be zero for ${txHash} on chainId=${chainId}`,
          );

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
      ),
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
}: GetContractsTXsInput): Promise<ExtendedCovalentGasRefundTransaction[]> => {
  // fail fast if this is a deadend
  if (epoch < GasRefundConsiderContractTXsStartEpoch) {
    return [];
  }

  const txsFromAllContracts = (await covalentGetTXsForContractV3({
    startTimestamp,
    endTimestamp,
    chainId,
    contract: contractAddress,
  })) as unknown as ExtendedCovalentGasRefundTransaction[];

  return txsFromAllContracts;
};
