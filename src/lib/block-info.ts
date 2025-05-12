import {
  CHAIN_ID_MAINNET,
  CHAIN_ID_BINANCE,
  CHAIN_ID_POLYGON,
  CHAIN_ID_FANTOM,
  CHAIN_ID_GOERLI,
  CHAIN_ID_OPTIMISM,
  CHAIN_ID_BASE,
} from './constants';
import { Utils } from './utils';
import { thegraphClient } from './utils/data-providers-clients';
import { createSubgraphURL } from './utils/subgraphs';

const logger = global.LOGGER();

export const SUBGRAPH_URL: { [network: number]: string } = {
  [CHAIN_ID_MAINNET]: createSubgraphURL(
    '9A6bkprqEG2XsZUYJ5B2XXp6ymz9fNcn4tVPxMWDztYC',
  ),
  [CHAIN_ID_OPTIMISM]: createSubgraphURL(
    'Dmht4UnVSfpuLcVr8i6TkNe93BSKWRD4iu2ZFY1Da4jj',
  ),
  [CHAIN_ID_BASE]: createSubgraphURL(
    '6f2Z8rTvsBQinEMwRSBxbyg3BP2LTFiEA1hjPZxmy3xs',
  ),
  [CHAIN_ID_BINANCE]: '', // not used (check GRP_V2_SUPPORTED_CHAINS_STAKING)
  [CHAIN_ID_GOERLI]: '', // not used (check GRP_V2_SUPPORTED_CHAINS_STAKING)
  [CHAIN_ID_POLYGON]: '', // not used (check GRP_V2_SUPPORTED_CHAINS_STAKING)
  [CHAIN_ID_FANTOM]: '', // not used (check GRP_V2_SUPPORTED_CHAINS_STAKING)
  // 43114: TODO: deploy blocks in avalanche
};
const SUBGRAPH_TIMEOUT = 10000;

export class BlockInfo {
  blockInfo: { [block: number]: number } = {};

  constructor(private subgraphURL: string) {}

  static instances: { [network: number]: BlockInfo } = {};

  static getInstance(network: number): BlockInfo {
    if (!this.instances[network]) {
      if (!SUBGRAPH_URL[network]) {
        throw new Error(`Subgraph URL is not available for network ${network}`);
      }
      this.instances[network] = new BlockInfo(SUBGRAPH_URL[network]);
    }
    return this.instances[network];
  }

  // This is just a special function to speed the block timestamp
  // fetching by updating the block info of a range of blocks
  async updateBlockInfo(fromBlock: number, toBlock: number) {
    // We can only get 100 entries from subgraph
    for (
      let lastFetchedBlock = fromBlock;
      lastFetchedBlock < toBlock;
      lastFetchedBlock += 100
    ) {
      // fetch the block info
      const query = `query ($number_gte: BigInt, $number_lt: BigInt) {
        blocks(orderBy: number, orderDirection: asc, where: {number_gte: $number_gte, number_lt: $number_lt}) {
          number
          timestamp
        }
      }`;
      const variables = {
        number_gte: lastFetchedBlock,
        number_lt: lastFetchedBlock + 100,
      };
      try {
        const {
          data: { data },
        } = await Utils._post(
          this.subgraphURL,
          { query, variables },
          SUBGRAPH_TIMEOUT,
        );
        data.blocks.map(
          (_block: { number: string; timestamp: string }) =>
            (this.blockInfo[parseInt(_block.number)] = parseInt(
              _block.timestamp,
            )),
        );
      } catch (e) {
        logger.error('updateBlockInfo', e);
      }
    }
  }

  // Get the timestamp of the block using blockInfo
  async getBlockTimeStamp(block: number): Promise<number | null> {
    if (block in this.blockInfo) return this.blockInfo[block];
    // if blockInfo is not available fetch the block info
    const query = `query ($block: BigInt) {
      blocks(first: 1, where: {number: $block}) {
        number
        timestamp
      }
    }`;
    const variables = {
      block,
    };
    try {
      const {
        data: { data },
      } = await thegraphClient.post(
        // TODO: replace everywhere else with thegraphClient. Going for minimal changes at time being
        this.subgraphURL,
        { query, variables },
      );
      this.blockInfo[parseInt(data.blocks[0].number)] = parseInt(
        data.blocks[0].timestamp,
      );
      return parseInt(data.blocks[0].timestamp);
    } catch (e) {
      logger.error('getBlockTimeStamp', e);
      return null;
    }
  }

  // Get the blocknumber for the block after time
  async getBlockAfterTimeStamp(time: number): Promise<number | null> {
    // fetch the block info
    const query = `query ($time_gte: BigInt) {
      blocks(first: 1, orderBy: timestamp, orderDirection: asc, where: {timestamp_gte: $time_gte}) {
        number
      }
    }`;
    const variables = {
      time_gte: time,
    };
    try {
      const {
        data: { data },
      } = await thegraphClient.post(this.subgraphURL, { query, variables });
      return parseInt(data.blocks[0].number);
    } catch (e) {
      logger.error('getBlockAfterTimeStamp', e);
      return null;
    }
  }
}
