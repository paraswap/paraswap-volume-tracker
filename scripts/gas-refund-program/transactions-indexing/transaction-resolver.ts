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
import { getSuccessfulSwaps } from './swaps-subgraph'
import { GasRefundTransaction, CovalentTransaction } from '../types'
import { GasRefundTxOriginCheckStartEpoch, GasRefundSwapSourceCovalentStartEpoch, AUGUSTUS_ADDRESS } from '../../../src/lib/gas-refund'

type GetAllTXsInput = {
  startTimestamp: number;
  endTimestamp: number;
  chainId: number;
  epoch: number;
}

export const getAllTXs = async ({epoch, chainId, startTimestamp, endTimestamp}: GetAllTXsInput): Promise<GasRefundTransaction[]> => {

  // fetch swaps and stakes
  const allTXs = await Promise.all([
    getSwapTXs({epoch, chainId, startTimestamp, endTimestamp}),
    getStakingTXs({chainId, startTimestamp, endTimestamp})
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
  startTimestamp: number;
  endTimestamp: number;
  chainId: number;
  epoch: number;
}
export const getSwapTXs = async ({ epoch, chainId, startTimestamp, endTimestamp }: GetSwapTXsInput): Promise<GasRefundTransaction[]> => {
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
      const swaps = await getSuccessfulSwaps({ startTimestamp, endTimestamp, chainId })

      // optionally filter out smart contract wallets
      const filteredSwaps = swaps.filter(swap =>
        epoch < GasRefundTxOriginCheckStartEpoch ||
        epoch >= GasRefundTxOriginCheckStartEpoch &&
        swap.initiator !== swap.txOrigin
      )

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

      return swapsWithGasUsedNormalised
    }
  })()


  return swaps
}

/**
 * staking and unstaking txs.
 * call covalent and get all txs within a period for a staking contract. do this
 * for all staking contracts.
 */
type GetStakingTXsInput = {
  chainId: number;
  startTimestamp: number;
  endTimestamp: number;
}
export const getStakingTXs = async ({
  startTimestamp,
  endTimestamp,
  chainId
}: GetStakingTXsInput): Promise<GasRefundTransaction[]> => {
  if (chainId !== 1)  return []
  // foreach staking pool, get txs within period
  const poolAddresses = Object.values(STAKING_POOL_ADDRESSES)
  const getTxsFromAllPools = [...Array(poolAddresses.length).keys()].map((i) => covalentGetTXsForContract({
    startTimestamp,
    endTimestamp,
    chainId,
    contract: poolAddresses[i]
  }))
  const poolsWithTxs = await Promise.all(getTxsFromAllPools)

  const txsFromAllPools = [].concat.apply([], poolsWithTxs) as CovalentTransaction[]

  // sort to be chronological
  const chronologicalTxs = txsFromAllPools.sort((a, b) => +(a.timestamp) - +(b.timestamp));

  const normalisedTXs: GasRefundTransaction[] = chronologicalTxs.map(tx => ({
    ...tx,
    blockNumber: tx.blockNumber.toString()
  }))

  return normalisedTXs
}

// todo: get safety module txs

// todo: get approval txs
