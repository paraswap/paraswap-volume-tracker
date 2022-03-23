import {
  CHAIN_ID_MAINNET,
  CHAIN_ID_ROPSTEN,
  CHAIN_ID_BINANCE,
  CHAIN_ID_POLYGON,
  CHAIN_ID_FANTOM,
} from './constants';
import { Utils } from './utils';

const logger = global.LOGGER();

const SUBGRAPH_URL: { [network: number]: string } = {
  [CHAIN_ID_MAINNET]:
    'https://api.thegraph.com/subgraphs/name/blocklytics/ethereum-blocks',
  [CHAIN_ID_ROPSTEN]:
    'https://api.thegraph.com/subgraphs/name/blocklytics/ropsten-blocks',
  [CHAIN_ID_BINANCE]:
    'https://api.thegraph.com/subgraphs/name/polytoken/blocks-bsc',
  [CHAIN_ID_POLYGON]:
    'https://api.thegraph.com/subgraphs/name/polytoken/blocks-matic',
  [CHAIN_ID_FANTOM]:
    'https://thegraph.com/hosted-service/subgraph/publu/fantom-blocks',
  // 43114: TODO: deploy blocks in avalanche
};
const SUBGRAPH_TIMEOUT = 5000;

export class BlockInfo {
  blockInfo: { [block: number]: number } = {};

  constructor(private subgraphURL: string) {}

  static instances: { [network: number]: BlockInfo } = {};

  static getInstance(network: number): BlockInfo {
    if (!this.instances[network]) {
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
      } = await Utils._post(
        this.subgraphURL,
        { query, variables },
        SUBGRAPH_TIMEOUT,
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
      } = await Utils._post(
        this.subgraphURL,
        { query, variables },
        SUBGRAPH_TIMEOUT,
      );
      return parseInt(data.blocks[0].number);
    } catch (e) {
      logger.error('getBlockAfterTimeStamp', e);
      return null;
    }
  }
}
