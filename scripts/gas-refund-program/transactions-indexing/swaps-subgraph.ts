import {
  CHAIN_ID_AVALANCHE,
  CHAIN_ID_BINANCE,
  CHAIN_ID_FANTOM,
  CHAIN_ID_MAINNET,
  CHAIN_ID_POLYGON,
} from '../../../src/lib/constants';
import { thegraphClient, covalentClient } from '../data-providers-clients';
import { sliceCalls } from '../utils';
import { assert } from 'ts-essentials';

// Note: txGasUsed from thegraph is unsafe as it's actually txGasLimit https://github.com/graphprotocol/graph-node/issues/2619
const SwapsQuery = `
query ($number_gte: BigInt, $number_lt: BigInt, $txOrgins: [Bytes!]!) {
	swaps(
		first: 1000
		orderBy: blockNumber
		orderDirection: asc
		where: {
			timestamp_gte: $number_gte
			timestamp_lt: $number_lt
			txOrigin_in: $txOrgins
		}
	) {
    txHash
		txOrigin
		txGasPrice
		blockNumber
    timestamp
	}
}
`;
const SubgraphURLs: { [network: number]: string } = {
  [CHAIN_ID_MAINNET]:
    'https://api.thegraph.com/subgraphs/name/paraswap/paraswap-subgraph',
  [CHAIN_ID_AVALANCHE]:
    'https://api.thegraph.com/subgraphs/name/paraswap/paraswap-subgraph-avalanche',
  [CHAIN_ID_BINANCE]:
    'https://api.thegraph.com/subgraphs/name/paraswap/paraswap-subgraph-bsc',
  [CHAIN_ID_POLYGON]:
    'https://api.thegraph.com/subgraphs/name/paraswap/paraswap-subgraph-polygon',
  [CHAIN_ID_FANTOM]:
    'https://api.thegraph.com/subgraphs/name/paraswap/paraswap-subgraph-fantom',
};

interface GetSwapsForAccountsInput {
  startTimestamp: number;
  endTimestamp: number;
  accounts: string[];
  chainId: number;
}

// get filtered by accounts swaps from the graphql endpoint
export async function getSwapsForAccounts({
  startTimestamp,
  endTimestamp,
  accounts,
  chainId,
}: GetSwapsForAccountsInput): Promise<SwapData[]> {
  const subgraphURL = SubgraphURLs[chainId];

  // @TODO set up pagination, but seems alright for now
  const execute = async (accounts: string[]): Promise<SwapData[]> => {
    const variables = {
      number_gte: startTimestamp,
      number_lt: endTimestamp,
      txOrgins: accounts,
    };

    const { data } = await thegraphClient.post<SwapsGQLRespose>(subgraphURL, {
      query: SwapsQuery,
      variables,
    });

    const swaps = data.data.swaps;

    assert(swaps.length !== 1000, 'unsafe fix pagination');

    return swaps;
  };

  // array of sliced results, without slicing breaks with Payload too large (too many `initiators`)
  const result = await Promise.all(
    sliceCalls({ inputArray: accounts, execute, sliceLength: 1000 }),
  );

  return result.flat();
}

interface SwapsGQLRespose {
  data: { swaps: SwapData[] };
}

interface SwapData {
  txHash: string;
  txOrigin: string;
  txGasPrice: string;
  blockNumber: number;
  timestamp: string;
}

type GetSwapsForNetwork = Omit<GetSwapsForAccountsInput, 'accounts'>

namespace Covalent {

  export interface Transaction {
    from_address: string
    to_address: string
    tx_hash: string
    block_height: number;
    block_signed_at: string;
    gas_offered: number,
    gas_spent: number,
    gas_price: number,
    fees_paid: number,
    gas_quote: number,
    gas_quote_rate: number,
    // ... and a lot more
  }
  export interface AddressTransactionsResponse {
    data: {
      data: {
        address: string
        chain_id: string
        quote_currency: string
        items: Transaction[]
        pagination: {
          has_more: boolean
          page_number: number
          page_size: number
          total_count: null
        }
      }
    }
  }
}

export async function getSwapsPerNetwork({
  startTimestamp,
  endTimestamp,
  chainId,
}: GetSwapsForNetwork): Promise<SwapData[]> {

  const AUGUSTUS = '0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57'

  const covalentAddressToSwap = (txCov: Covalent.Transaction): SwapData => ({
    txHash: txCov.tx_hash,
    txOrigin: txCov.from_address,
    txGasPrice: txCov.gas_spent.toString(),
    // todo: should be string to match subgraph data, but type is numeric
    blockNumber: txCov.block_height,
    // convert time to unixtime - seconds
    timestamp: (new Date(txCov.block_signed_at).getTime() / 1000).toString(),
  })

  // filter out smart contract wallets
  const filterTXs = (txCov: Covalent.Transaction): boolean => {
    return txCov.to_address.toLowerCase() === AUGUSTUS.toLowerCase()
  }

  // todo: add safety margin to both start/end and de-dup later
  const { COVALENT_API_KEY } = process.env
  const path = (page: number) => {

    // these query params should be calculated for each request (since time sensitive)
    const startSecondsAgo = Math.floor((new Date().getTime()) / 1000) - startTimestamp
    const duration = endTimestamp - startTimestamp
    /**
     * NOTE: for this to work, we must only query historic data.
     * if start limit + duration is not less than now, we'll get
     * live data which may change across paginations since it is
     * still forming.
     */
    if (endTimestamp > Date.now()) {
      throw new Error('only query historic data')
    }

    return `/${chainId}/address/${AUGUSTUS}/transactions_v2/?key=${COVALENT_API_KEY}&no-logs=true&page-number=${page}&page-size=1000&block-signed-at-limit=${startSecondsAgo}&block-signed-at-span=${duration}`
  }


  let items: SwapData[] = []
  let hasMore = true
  let page = 1
  let calls = 0
  var timeAllStart = new Date();

  // todo: better would be to first call the end point with page-size=0 just to get the total number of items, and then construct many request promises and run concurrently - currently this isn't possible due to a flaw in the covalent api

  while (hasMore) {
    const route = path(page)
    var timeRequestStart = new Date();
    const { data } = await covalentClient.get(route)

    const { data: { pagination: { has_more }, items: receivedItems }} = data

    hasMore = has_more
    page++

    items = [...items, ...receivedItems.filter(filterTXs).map(covalentAddressToSwap)]

    calls++
    const timeRequestEnd = new Date();
    const secondsForRequest: number = (+timeRequestEnd - +timeRequestStart) / 1000;

    console.log({calls, route, secondsForRequest})
  }
  const timeAllEnd = new Date();
  const millisecondsElapsed: number = +timeAllEnd - +timeAllStart;
  console.log(`time to get all requests`, millisecondsElapsed / 1000)

  return items
}
