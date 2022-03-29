import {
  CHAIN_ID_AVALANCHE,
  CHAIN_ID_BINANCE,
  CHAIN_ID_FANTOM,
  CHAIN_ID_MAINNET,
  CHAIN_ID_POLYGON,
} from '../../../src/lib/constants';
import { Utils } from '../../../src/lib/utils';
import { sliceCalls } from '../utils';

const SwapsQuery = `
query ($number_gte: BigInt, $number_lt: BigInt, $txOrgins: [Bytes!]!) {
	swaps(
		first: 1000
		orderBy: blockNumber
		orderDirection: asc
		where: {
			blockNumber_gte: $number_gte
			blockNumber_lt: $number_lt
			txOrigin_in: $txOrgins
		}
	) {
    txHash
		txOrigin
		txGasUsed
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
  startBlock: number;
  endBlock: number;
  accounts: string[];
  chainId: number;
}

// get filtered by accounts swaps from the graphql endpoint
export async function getSwapsForAccounts({
  startBlock,
  endBlock,
  accounts,
  chainId,
}: GetSwapsForAccountsInput): Promise<SwapData[]> {
  const subgraphURL = SubgraphURLs[chainId];

  const execute = async (accounts: string[]): Promise<SwapData[]> => {
    const variables = {
      number_gte: startBlock,
      number_lt: endBlock,
      txOrgins: accounts,
    };

    const { data } = await Utils._post<SwapsGQLRespose>(
      subgraphURL,
      { query: SwapsQuery, variables },
      5000,
    );

    return data.data.swaps;
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
  txGasUsed: string;
  txGasPrice: string;
  blockNumber: number;
  timestamp: number;
}
