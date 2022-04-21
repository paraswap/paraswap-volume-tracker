import {
  CHAIN_ID_AVALANCHE,
  CHAIN_ID_BINANCE,
  CHAIN_ID_FANTOM,
  CHAIN_ID_MAINNET,
  CHAIN_ID_POLYGON,
} from '../../../src/lib/constants';
import { thegraphClient } from '../data-providers-clients';
import { assert } from 'ts-essentials';

// Note: txGasUsed from thegraph is unsafe as it's actually txGasLimit https://github.com/graphprotocol/graph-node/issues/2619
const SwapsQuery = `
query ($number_gte: BigInt, $number_lt: BigInt) {
	swaps(
		first: 1000
		orderBy: blockNumber
		orderDirection: asc
		where: {
			timestamp_gte: $number_gte
			timestamp_lt: $number_lt
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
  chainId: number;
}

// get filtered by accounts swaps from the graphql endpoint
export async function getSuccessfulSwapTransactions({
  startTimestamp,
  endTimestamp,
  chainId,
}: GetSwapsForAccountsInput): Promise<SwapData[]> {
  const subgraphURL = SubgraphURLs[chainId];

  const variables = {
    number_gte: startTimestamp,
    number_lt: endTimestamp,
  };

  const { data } = await thegraphClient.post<SwapsGQLRespose>(subgraphURL, {
    query: SwapsQuery,
    variables,
  });

  const swaps = data.data.swaps;

  assert(swaps.length !== 1000, 'unsafe fix pagination');

  return swaps;
}

interface SwapsGQLRespose {
  data: { swaps: SwapData[] };
}

interface SwapData {
  txHash: string;
  txOrigin: string;
  txGasPrice: string;
  blockNumber: string;
  timestamp: string;
}
