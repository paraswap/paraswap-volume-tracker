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
import { covalentGetTXsForContract } from './txs-covalent';
import { getTransactionGasUsed } from '../../../src/lib/utils/covalent';
import StakesTracker from '../staking/stakes-tracker';
import { getSuccessfulSwaps } from './swaps-subgraph';
import { GasRefundTransaction } from '../types';
import {
  GasRefundConsiderContractTXsStartEpoch,
  GRP_MIN_STAKE,
} from '../../../src/lib/gas-refund';
import {
  CHAIN_ID_MAINNET,
  SAFETY_MODULE_ADDRESS,
  AUGUSTUS_V5_ADDRESS,
} from '../../../src/lib/constants';

type GetAllTXsInput = {
  startTimestamp: number;
  endTimestamp: number;
  chainId: number;
  epoch: number;
  epochEndTimestamp: number;
  contractAddress: string;
};

const CovalentAddressesByChain: Record<number, string[]> = {
  [CHAIN_ID_MAINNET]: [...SPSPAddresses, SAFETY_MODULE_ADDRESS],
};

export const getContractAddresses = ({
  chainId,
  epoch,
}: {
  chainId: number;
  epoch: number;
}) => {
  if (epoch < GasRefundConsiderContractTXsStartEpoch)
    return [AUGUSTUS_V5_ADDRESS];

  return (CovalentAddressesByChain[chainId] || []).concat(AUGUSTUS_V5_ADDRESS);
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
  return contractAddress === AUGUSTUS_V5_ADDRESS
    ? getSwapTXs({
        epoch,
        chainId,
        startTimestamp,
        endTimestamp,
        epochEndTimestamp,
      })
    : getTransactionForContract({
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
    const swapperStake = StakesTracker.getInstance().computeStakedPSPBalance(
      swap.txOrigin,
      +swap.timestamp,
      epoch,
      epochEndTimestamp,
    );
    // tx address must be a staker && must not be over their budget in order to be processed
    return swapperStake.isGreaterThanOrEqualTo(GRP_MIN_STAKE);
  });

  // augment with gas used and the pertaining contract the tx occured on
  const swapsWithGasUsedNormalised: GasRefundTransaction[] = await Promise.all(
    swapsOfQualifyingStakers.map(
      async ({ txHash, txOrigin, txGasPrice, timestamp, blockNumber }) => {
        const txGasUsed = await getTransactionGasUsed({
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
}: GetContractsTXsInput): Promise<GasRefundTransaction[]> => {
  // fail fast if this is a deadend
  if (epoch < GasRefundConsiderContractTXsStartEpoch) {
    return [];
  }

  const txsFromAllContracts = (await covalentGetTXsForContract({
    startTimestamp,
    endTimestamp,
    chainId,
    contract: contractAddress,
  })) as unknown as GasRefundTransaction[];

  return txsFromAllContracts;
};
