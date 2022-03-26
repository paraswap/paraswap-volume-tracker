import { CHAIN_ID_AVALANCHE, CHAIN_ID_BINANCE, CHAIN_ID_FANTOM, CHAIN_ID_MAINNET, CHAIN_ID_POLYGON } from "../../lib/constants";
import { Utils } from "../../lib/utils";
import { sliceCalls } from "./utils";

const SwapsQuery = `
query ($number_gte: BigInt, $number_lt: BigInt, $initiators: [Bytes!]!) {
	swaps(
		first: 1000
		orderBy: blockNumber
		orderDirection: asc
		where: {
			blockNumber_gte: $number_gte
			blockNumber_lt: $number_lt
			initiator_in: $initiators
		}
	) {
		id
		uuid
		augustus
		augustusVersion
		side
		method
		initiator
		beneficiary
		srcToken
		destToken
		srcAmount
		destAmount
		expectedAmount
		referrer
		txHash
		txOrigin
		txTarget
		txGasUsed
		txGasPrice
		blockHash
		blockNumber
		timestamp
	}
}
`
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
  startBlock: number,
  endBlock: number,
  accounts: string[]
  chainId: number
}

export async function getSwapsForAccounts({ startBlock, endBlock, accounts, chainId }: GetSwapsForAccountsInput): Promise<SwapData[]> {
  const subgraphURL = SubgraphURLs[chainId]

  const execute = async (accounts: string[]): Promise<SwapData[]> => {
    const variables = {
      number_gte: startBlock,
      number_lt: endBlock,
      initiators: accounts
    }
  
  
    // @TODO set up pagination, but seems alright for now
    const {
      data,
    } = await Utils._post<SwapsGQLRespose>(
      subgraphURL,
      { query: SwapsQuery, variables },
      5000,
    );

    return data.data.swaps
  }

  // array of sliced results, without slicing breaks with Payload too large (too many `initiators`)
  const result = await Promise.all(sliceCalls({inputArray: accounts, execute, sliceLength: 1000}))

  return result.flat()
}

interface SwapsGQLRespose {
  data: { swaps: SwapData[] }
}


interface SwapData {
  "id": string // hex lowercase
  "uuid": null,
  "augustus": string // address lowecase
  "augustusVersion": string // semver, 5.0.0
  "side": "Sell" | "Buy"
  "method": string // contract method
  "initiator": string // address lowercase
  "beneficiary": string // address lowercase, same as initiator if no beneficiary
  "srcToken": string // address lowercase
  "destToken": string // address lowercase
  "srcAmount": string // wei?
  "destAmount": string
  "expectedAmount": null,
  "referrer": null, // ?
  "txHash": string // lowecase
  "txOrigin": string // same as initiator, mostly
  "txTarget": string // ?
  "txGasUsed": string
  "txGasPrice": string
  "blockHash": string // lowercase
  "blockNumber": string
  "timestamp": string
}