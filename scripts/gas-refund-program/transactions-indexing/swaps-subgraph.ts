import {
  CHAIN_ID_AVALANCHE,
  CHAIN_ID_BINANCE,
  CHAIN_ID_FANTOM,
  CHAIN_ID_MAINNET,
  CHAIN_ID_POLYGON,
} from '../../../src/lib/constants';
import { thegraphClient } from '../data-providers-clients';
import { queryPaginatedData, QueryPaginatedDataParams } from '../utils';

// Note: txGasUsed from thegraph is unsafe as it's actually txGasLimit https://github.com/graphprotocol/graph-node/issues/2619
const SwapsQuery = `
query ($number_gte: BigInt, $number_lt: BigInt, $first: Int, $skip: Int) {
	swaps(
		first: $first
    skip: $skip
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
    initiator
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

interface GetSuccessSwapsInput {
  startTimestamp: number;
  endTimestamp: number;
  chainId: number;
}

// get filtered by accounts swaps from the graphql endpoint
export async function getSuccessfulSwaps({
  startTimestamp,
  endTimestamp,
  chainId,
}: GetSuccessSwapsInput): Promise<SwapData[]> {
  const subgraphURL = SubgraphURLs[chainId];

  const fetchSwaps = async ({ skip, pageSize }: QueryPaginatedDataParams) => {
    const variables = {
      number_gte: startTimestamp,
      number_lt: endTimestamp,
      skip,
      pageSize,
    };

    const { data } = await thegraphClient.post<SwapsGQLRespose>(subgraphURL, {
      query: SwapsQuery,
      variables,
    });

    const swaps = data.data.swaps;

    return swaps;
  };

  const swaps = await queryPaginatedData(fetchSwaps, 100);

  return swaps;
}

interface SwapsGQLRespose {
  data: { swaps: SwapData[] };
}

export interface SwapData {
  txHash: string;
  txOrigin: string;
  initiator: string;
  txGasPrice: string;
  blockNumber: number;
  timestamp: string;
}
