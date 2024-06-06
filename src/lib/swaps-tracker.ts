import * as _ from 'lodash';
import BigNumber from 'bignumber.js';
import { JsonRpcProvider } from '@ethersproject/providers';
import { Contract } from '@ethersproject/contracts';
import {
  ZeroXV4Address,
  ZeroXV2Address,
  Web3Provider,
  CHAIN_ID_MAINNET,
  CHAIN_ID_BINANCE,
  CHAIN_ID_POLYGON,
  CHAIN_ID_AVALANCHE,
  CHAIN_ID_FANTOM,
} from './constants';
import { PriceApi } from './price-api';
import { BlockInfo } from './block-info';
import * as ZeroXV2Abi from './abi/zerox.v2.abi.json';
import * as ZeroXV4Abi from './abi/zerox.v4.abi.json';
import { Utils } from './utils';

const logger = global.LOGGER();

export type Swap = {
  id: string;
  uuid: string | null;
  augustus: string;
  augustusVersion: string;
  side: string;
  method: string;
  initiator: string;
  beneficiary: string;
  srcToken: string;
  destToken: string;
  srcAmount: bigint;
  srcAmountUSD: string | null;
  destAmount: bigint;
  destAmountUSD: string | null;
  expectedAmount: bigint | null;
  expectedAmountUSD: string | null;
  referrer: string | null;
  txHash: string;
  txOrigin: string;
  txTarget: string;
  txGasUsed: bigint;
  txGasPrice: bigint;
  blockHash: string;
  blockNumber: number;
  timestamp: number;
};

const INIT_TIME = parseInt(process.env.INIT_TIME || '0'); //TODO: use the block info to the init time from the init block
const defaultBlockDelay = 20;
const defaultIndexRefreshDelay = 5 * 60 * 1000;

const BN_0 = new BigNumber('0');

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

const InitTime: { [network: number]: number } = {
  [CHAIN_ID_MAINNET]: 10952443,
  [CHAIN_ID_AVALANCHE]: 3961034,
  [CHAIN_ID_BINANCE]: 6729804,
  [CHAIN_ID_POLYGON]: 13049712,
};

const SubgraphQuery = `query ($number_gte: BigInt, $number_lt: BigInt) {
  swaps(first: 1000, orderBy: blockNumber, orderDirection: asc, where: {blockNumber_gte: $number_gte, blockNumber_lt: $number_lt}) {
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
}`;

const SUBGRAPH_TIMEOUT = 10000;

export class SwapsTracker {
  static instances: {
    [network: number]: SwapsTracker;
  } = {};
  // Block height should consider the number of
  // entries that can be fetched by the subgraph
  blockFetchHeight: number = 50;
  isIndexing: boolean = false;

  indexedSwaps: { [block: number]: Swap[] } = {};
  lastIndexedBlock: number | null = null;
  provider: JsonRpcProvider;
  priceApi: PriceApi;
  blockInfo: BlockInfo;
  initBlock: number | null = null;
  subgraphURL: string;
  initTime: number;

  private constructor(
    protected network: number = CHAIN_ID_MAINNET,
    protected skipTokenPricing: boolean = false,
    protected blockDelay = defaultBlockDelay,
    protected indexRefreshDelay = defaultIndexRefreshDelay,
  ) {
    this.provider = new JsonRpcProvider(Web3Provider[this.network]);
    this.subgraphURL = SubgraphURLs[this.network];
    this.initTime = InitTime[this.network];
    this.priceApi = new PriceApi(this.initTime, this.network);
    this.blockInfo = BlockInfo.getInstance(this.network);
  }

  static getInstance(
    network: number,
    skipTokenPricing: boolean = false,
  ): SwapsTracker {
    if (!this.instances[network])
      this.instances[network] = new SwapsTracker(network, skipTokenPricing);
    return this.instances[network];
  }

  async indexSwaps(
    fromBlock: number,
    toBlock: number,
    retriesLeft: number = 5,
  ) {
    try {
      const variables = {
        number_gte: fromBlock,
        number_lt: toBlock,
      };

      console.log('indexSwaps', this.subgraphURL, JSON.stringify(variables));
      const {
        data: { data },
      } = await Utils._post(
        this.subgraphURL,
        { query: SubgraphQuery, variables },
        SUBGRAPH_TIMEOUT,
      );
      if (!data || !data.swaps)
        throw new Error('Unable to fetch swaps from the subgraph');

      await Promise.all(
        data.swaps.map(async (swap: any) => {
          const blockNumber = parseInt(swap.blockNumber);

          const srcAmountUSD = this.skipTokenPricing
            ? null
            : (
                await this._getTokenPrice(
                  blockNumber,
                  swap.srcToken,
                  new BigNumber(swap.srcAmount),
                )
              ).toFixed();

          const destAmountUSD = this.skipTokenPricing
            ? null
            : (
                await this._getTokenPrice(
                  blockNumber,
                  swap.destToken,
                  new BigNumber(swap.destAmount),
                )
              ).toFixed();

          const expectedAmountUSD = this.skipTokenPricing
            ? null
            : swap.expectedAmount
            ? (
                await this._getTokenPrice(
                  blockNumber,
                  swap.side === 'Sell' ? swap.destToken : swap.srcToken,
                  new BigNumber(swap.expectedAmount),
                )
              ).toFixed()
            : null;

          if (!this.indexedSwaps[blockNumber])
            this.indexedSwaps[blockNumber] = [];

          return this.indexedSwaps[blockNumber].push({
            id: swap.id,
            uuid: swap.uuid,
            augustus: swap.augustus,
            augustusVersion: swap.augustusVersion,
            side: swap.side,
            method: swap.method,
            initiator: swap.initiator,
            beneficiary: swap.beneficiary,
            srcToken: swap.srcToken,
            destToken: swap.destToken,
            srcAmount: BigInt(swap.srcAmount),
            srcAmountUSD,
            destAmount: BigInt(swap.destAmount),
            destAmountUSD,
            expectedAmount: swap.expectedAmount
              ? BigInt(swap.expectedAmount)
              : null,
            expectedAmountUSD,
            referrer: swap.referrer,
            txHash: swap.txHash,
            txOrigin: swap.txOrigin,
            txTarget: swap.txTarget,
            txGasUsed: BigInt(swap.txGasUsed),
            txGasPrice: BigInt(swap.txGasPrice),
            blockHash: swap.blockHash,
            blockNumber,
            timestamp: parseInt(swap.timestamp),
          });
        }),
      );

      logger.info(`Indexed Swaps ${fromBlock}: ${toBlock}`);
    } catch (e) {
      if (retriesLeft) {
        logger.warn(`_indexSwaps: Retries Left ${retriesLeft}`, e);
        await this.indexSwaps(fromBlock, toBlock, retriesLeft - 1);
      } else {
        logger.error(`_indexSwaps: Retries Left ${retriesLeft}`, e);
      }
    }
  }

  async _getTokenPrice(
    block: number,
    token: string,
    amount: BigNumber,
  ): Promise<BigNumber> {
    const blockTimeStamp = await this.blockInfo.getBlockTimeStamp(block);
    if (!blockTimeStamp) {
      logger.warn(`_getTokenPrice: got null blockTimeStamp for ${block}`);
      return BN_0;
    }
    const price = await this.priceApi.getPriceUSD(
      token,
      amount,
      blockTimeStamp,
    );
    return price;
  }

  async indexLatest() {
    if (this.isIndexing) return;
    logger.info(`Indexing started`);
    this.isIndexing = true;
    try {
      if (!this.lastIndexedBlock) {
        this.initBlock = await this.blockInfo.getBlockAfterTimeStamp(
          this.initTime,
        );
        if (!this.initBlock) {
          logger.error(
            `_indexLatest: unable to fetch block number for ${this.initTime}`,
          );
          return;
        }
        this.lastIndexedBlock = this.initBlock;
      }
      const latestBlock = await this.provider.getBlock('latest');
      const maxToBlockNumber = latestBlock.number - this.blockDelay;
      while (this.lastIndexedBlock! < maxToBlockNumber) {
        const toBlock: number =
          this.lastIndexedBlock! + this.blockFetchHeight >= maxToBlockNumber
            ? maxToBlockNumber
            : this.lastIndexedBlock! + this.blockFetchHeight;

        _.range(this.lastIndexedBlock!, toBlock, 1).map(
          i => (this.indexedSwaps[i] = []),
        );

        await this.blockInfo.updateBlockInfo(this.lastIndexedBlock!, toBlock);
        await this.indexSwaps(this.lastIndexedBlock!, toBlock);
        this.lastIndexedBlock = toBlock;
      }
      logger.info(`Indexing completed`);
    } finally {
      this.isIndexing = false;
    }
  }

  async startIndexing() {
    if (!this.skipTokenPricing) await this.priceApi.init();
    await this.indexLatest();
    setInterval(() => this.indexLatest(), this.indexRefreshDelay);
  }
}
