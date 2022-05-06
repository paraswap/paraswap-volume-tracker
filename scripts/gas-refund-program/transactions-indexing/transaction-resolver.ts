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
import { STAKING_POOL_ADDRESSES } from '../../../src/lib/gas-refund'
import { covalentGetTXsForContract } from './txs-covalent'
import { getTransactionGasUsed } from '../staking/covalent';
import StakesTracker from '../staking/stakes-tracker';
import { getSuccessfulSwaps } from './swaps-subgraph'
import { GasRefundTransaction, CovalentTransaction } from '../types'
import { GasRefundTxOriginCheckStartEpoch, GasRefundSwapSourceCovalentStartEpoch, AUGUSTUS_ADDRESS, GRP_MIN_STAKE } from '../../../src/lib/gas-refund'

type GetAllTXsInput = {
  startTimestamp: number;
  endTimestamp: number;
  chainId: number;
  epoch: number;
  epochEndTimestamp: number;
}

export const getAllTXs = async ({ epoch, chainId, startTimestamp, endTimestamp, epochEndTimestamp }: GetAllTXsInput): Promise<GasRefundTransaction[]> => {

  // foreach staking pool (assuming we're checking mainnet)
  const poolAddresses = chainId === 1 ? Object.values(STAKING_POOL_ADDRESSES) : []

  // fetch swaps and stakes
  const allTXs = await Promise.all([
    getSwapTXs({epoch, chainId, startTimestamp, endTimestamp, epochEndTimestamp}),
    getContractsTXs({chainId, startTimestamp, endTimestamp, whiteListedAddresses: poolAddresses})
  ])

  const allTXsFlattened = [].concat.apply([], allTXs) as GasRefundTransaction[]

  // sort to be chronological
  const allTXsChronological = allTXsFlattened.sort((a, b) => +(a.timestamp) - +(b.timestamp));

  return allTXsChronological
}


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
}
export const getSwapTXs = async ({ epoch, chainId, startTimestamp, endTimestamp, epochEndTimestamp }: GetSwapTXsInput): Promise<GasRefundTransaction[]> => {
  const swaps: GasRefundTransaction[] = await (async () => {
    // todo: epoch check when we change over - remove `false &&`
    if (false && epoch >= GasRefundSwapSourceCovalentStartEpoch) {
      // get from covalent
      const swapsFromCovalent = await covalentGetTXsForContract({
        startTimestamp,
        endTimestamp,
        chainId,
        contract: AUGUSTUS_ADDRESS
      })
      const normalisedSwapsFromCovalent = swapsFromCovalent.map(swap => ({
        ...swap,
        blockNumber: swap.blockNumber.toString()
      }))
      return normalisedSwapsFromCovalent
    } else {
      // get swaps from the graph
      const swaps = await getSuccessfulSwaps({ startTimestamp, endTimestamp, chainId, epoch })

      // optionally filter out smart contract wallets
      const filteredSwaps = swaps.filter(swap =>
        epoch < GasRefundTxOriginCheckStartEpoch ||
        epoch >= GasRefundTxOriginCheckStartEpoch &&
        swap.initiator !== swap.txOrigin
      )

      // check the swapper is a staker to avoid subsequently wasting resources looking up gas unnecessarily
      const swapsOfQualifyingStakers = filteredSwaps.map(swap => {
        const swapperStake = StakesTracker.getInstance().computeStakedPSPBalance(
          swap.txOrigin,
          +swap.timestamp,
          epoch,
          epochEndTimestamp
        )
        return !swapperStake.isLessThan(GRP_MIN_STAKE)
      })

      // augment with gas used
      const swapsWithGasUsedNormalised: GasRefundTransaction[] = await Promise.all(
        filteredSwaps.map(async ({
          txHash,
          txOrigin,
          txGasPrice,
          timestamp,
          blockNumber
        }) => {
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
            txGasUsed: txGasUsed.toString()
          }
        })
      )

      return swapsOfQualifyingStakers
    }
  })()


  return swaps
}

/**
 * staking and unstaking txs.
 * call covalent and get all txs within a period for a staking contract. do this
 * for all staking contracts.
 */
type GetContractsTXsInput = {
  chainId: number;
  startTimestamp: number;
  endTimestamp: number;
  whiteListedAddresses: string[]
}
export const getContractsTXs = async ({
  startTimestamp,
  endTimestamp,
  chainId,
  whiteListedAddresses
}: GetContractsTXsInput): Promise<GasRefundTransaction[]> => {

  const getTxsFromAllContracts = [...Array(whiteListedAddresses.length).keys()].map((i) => covalentGetTXsForContract({
    startTimestamp,
    endTimestamp,
    chainId,
    contract: whiteListedAddresses[i]
  }))
  const txsAcrossContracts = await Promise.all(getTxsFromAllContracts)

  const txsFromAllContracts = [].concat.apply([], txsAcrossContracts) as CovalentTransaction[]

  // sort to be chronological
  const chronologicalTxs = txsFromAllContracts.sort((a, b) => +(a.timestamp) - +(b.timestamp));

  const normalisedTXs: GasRefundTransaction[] = chronologicalTxs.map(tx => ({
    ...tx,
    blockNumber: tx.blockNumber.toString()
  }))

  return normalisedTXs
}
