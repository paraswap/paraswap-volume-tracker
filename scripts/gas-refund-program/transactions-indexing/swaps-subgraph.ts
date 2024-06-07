import { assert } from 'ts-essentials';
import {
  CHAIN_ID_AVALANCHE,
  CHAIN_ID_BINANCE,
  CHAIN_ID_FANTOM,
  CHAIN_ID_MAINNET,
  CHAIN_ID_OPTIMISM,
  CHAIN_ID_POLYGON,
} from '../../../src/lib/constants';
import {
  GasRefundDeduplicationStartEpoch,
  GasRefundTxOriginCheckStartEpoch,
} from '../../../src/lib/gas-refund/gas-refund';
import {
  queryPaginatedData,
  QueryPaginatedDataParams,
} from '../../../src/lib/utils/helpers';
import { thegraphClient } from '../../../src/lib/utils/data-providers-clients';
import { createSubgraphURL } from '../../../src/lib/utils/subgraphs';

const REORGS_BLOCKHASH_BY_CHAIN_ID: Record<string, string[]> = {
  [CHAIN_ID_POLYGON]: [
    '0x2019b19233191f463805ce55f5aaedb139cff358408da5e3d145c20dab47dab5',
    '0x4c48a4abde9207bcde996f3aa48741114d2eb8a0fea8ccecab9583ee5f6da235',
    '0x59531b71968e5fff106aeb906d2cc8d0331fb29ed6b212c88d76657725786d99',
    '0xee147a1eebe2388a1dc1bf7c5fd37d00184f436944be91575204fa37747894be',
    '0x40c770e58c9209cdadc56488c71e3e2a03dfc7315767dab51506f36f4eb2ef20',
    '0x6d33357eae16909b026405566f5cb124fb4abec9e2b10a879ffefaa931fd7a65',
    '0x8983e5e4b235842f682268d6c429f047c75ed3129e82813458248612a567d136',
    '0x2a2aae9c205bae7a9919ee132bfc7c6e6a3311d5f743f72aefcd061b55a121c7',
    '0xf0c2f17ca651e879c2cbb230915100c23cc96827d69edbed1a05238839bd3983',
    '0x51204b8722436fac828ae86c723192bbef030f6992a6c115a65fb099eeaacc90',
    '0x5cb6a95f305213fab875a295e251b3e215a748eee1d01caeec1b58cfa7ec631d',
    '0x8bb6e2691f09fbaa74ba3822cb3d63b937ad9959e1730bbb7949b13d5dcdff8f',
    '0xe4907ed79d7b19e992cbe40f638cf27304af9698310697a7be480db08dcf0220',
  ],
};

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

const SwapsQueryBlockHash = `
query ($number_gte: BigInt, $number_lt: BigInt, $blockHashes: [Bytes!], $first: Int, $skip: Int) {
	swaps(
		first: $first
    skip: $skip
		orderBy: blockNumber
		orderDirection: asc
		where: {
			timestamp_gte: $number_gte
			timestamp_lt: $number_lt
      blockHash_not_in: $blockHashes
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
  [CHAIN_ID_MAINNET]: createSubgraphURL(
    '8k74P7fPtsB5EZu53iDGQUMHtWuAH4YCKwBawySvkhSa',
  ),
  [CHAIN_ID_OPTIMISM]: createSubgraphURL(
    'CxWHhhC2gaaFSgVPqACipZQMQesWUxWc1fmESNCjNkf8',
  ), // covalent used instead (check transaction-resolver.ts:110)
  [CHAIN_ID_AVALANCHE]: createSubgraphURL(
    'DMJXB2sBBXD66Lyk3dBEpktQwHX9Vu2hirDCKmLgPWQ8',
  ), // not used (not in the GRP_SUPPORTED_CHAINS list)
  [CHAIN_ID_BINANCE]: createSubgraphURL(
    '2aWZK7r2mhBjwxs5yEsuJVEnhmnoppHm7RufzqQKLqQf',
  ),
  [CHAIN_ID_POLYGON]: createSubgraphURL(
    'D72KzovXDszkzbkaekhAGY3j3nA2GHbusuikk7QsDX8G',
  ),
  [CHAIN_ID_FANTOM]: createSubgraphURL(
    '89HymAx5uhrkJ4KuZFdZGJsMQFcbUZ6d3xiXoeknmnak',
  ),
};

interface GetSuccessSwapsInput {
  startTimestamp: number;
  endTimestamp: number;
  chainId: number;
  epoch: number;
}

// get filtered by accounts swaps from the graphql endpoint
export async function getSuccessfulSwaps({
  startTimestamp,
  endTimestamp,
  chainId,
  epoch,
}: GetSuccessSwapsInput): Promise<SwapData[]> {
  const subgraphURL = SubgraphURLs[chainId];
  if (!subgraphURL) {
    throw new Error(`Subgraph URL is not available for network ${chainId}`);
  }

  const regorgBlockHashes = REORGS_BLOCKHASH_BY_CHAIN_ID[chainId];

  const fetchSwaps = async ({ skip, pageSize }: QueryPaginatedDataParams) => {
    const variables = Object.assign(
      {},
      {
        number_gte: startTimestamp,
        number_lt: endTimestamp,
        skip,
        first: pageSize,
      },
      regorgBlockHashes
        ? {
            blockHashes: regorgBlockHashes,
          }
        : {},
    );

    const { data } = await thegraphClient.post<SwapsGQLRespose>(subgraphURL, {
      query: regorgBlockHashes ? SwapsQueryBlockHash : SwapsQuery,
      variables,
    });

    const swaps = data.data.swaps;

    return swaps;
  };

  const swaps = await queryPaginatedData(fetchSwaps, 100);

  if (epoch < GasRefundTxOriginCheckStartEpoch) {
    return swaps;
  }

  const swapsWithTxOriginEqMsgSender = swaps.filter(
    swap => swap.initiator.toLowerCase() === swap.txOrigin.toLowerCase(),
  );

  if (epoch < GasRefundDeduplicationStartEpoch) {
    return swapsWithTxOriginEqMsgSender;
  }

  const uniqSwapTxHashes = [
    ...new Set(swapsWithTxOriginEqMsgSender.map(swap => swap.txHash)),
  ];

  assert(
    uniqSwapTxHashes.length === swapsWithTxOriginEqMsgSender.length,
    'duplicates found',
  );

  return swapsWithTxOriginEqMsgSender;
}

interface SwapsGQLRespose {
  data: { swaps: SwapData[] };
}

export interface SwapData {
  txHash: string;
  txOrigin: string;
  initiator: string;
  txGasPrice: string;
  blockNumber: string;
  timestamp: string;
}
