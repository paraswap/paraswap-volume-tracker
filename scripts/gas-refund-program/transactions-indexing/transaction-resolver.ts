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
import { GasRefundTransaction, CovalentTransaction } from '../types'

// todo:
// const getTXs = async ({chainId, timeStart, timeEnd, txType}: { chainId: number, timeStart: number, timeEnd: number, txType?: TransactionType }): Promise<GasRefundTransaction[]> => {
//   // todo: return all in chronological order
//   // todo: build promise array to fetch swaps /  stakes as `txType` param dictates

//   // todo: sort to be chronological

//   return []
// }

// todo: get swaps
/**
 * this will take an epoch, a chain, and two timespan values (min/max).
 * it will use subgraph for now (and augment gas data via a covalent call),
 * but later resolve to covalent after a certain epoch.
*/
const getSwapTXs = async (): Promise<GasRefundTransaction[]> => {
  // todo: call the graph as before - and augment - unless after epoch whatever then get from covalent
  // todo: if getting swaps from the graph, filter out those where initiator !== txOrigin
  return []
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

  const returnItems = (chronologicalTxs as GasRefundTransaction[])

  return returnItems
}

// todo: get safety module txs

// todo: get approval txs
