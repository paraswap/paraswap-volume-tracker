import * as _ from 'lodash';
import BigNumber from 'bignumber.js';
import parsePeriod from 'parse-duration';
import * as moment from 'moment';
import type { JsonRpcProvider } from '@ethersproject/providers';
import { Contract } from '@ethersproject/contracts';
import {
  AugustusV5Address,
  AugustusV4Address,
  ZeroXV4Address,
  ZeroXV2Address,
  CHAIN_ID_MAINNET,
} from './constants';
import { Provider } from './provider';
import { PriceApi } from './price-api';
import { BlockInfo } from './block-info';
import * as ZeroXV2Abi from './abi/zerox.v2.abi.json';
import * as ZeroXV4Abi from './abi/zerox.v4.abi.json';
import { generatePeriods, MAX_PERIOD, VolumesCache } from './volume-cache';
import { Op } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { DataType_USD_VALUE_DECIMALS } from './sql-data-types';
import Database from '../database';
import { Volume, VolumeAttributes } from '../models/Volume';
import { VolumeSyncStatus } from '../models/VolumeSyncStatus';

const logger = global.LOGGER();

const INIT_TIME = parseInt(process.env.INIT_TIME || '0'); //TODO: use the block info to the init time from the init block
if (!INIT_TIME) {
  throw new Error('VolumeTracker INIT_TIME env var is missing');
}

const defaultBlockDelay = 20;
const defaultIndexRefreshDelay = 5 * 60 * 1000;

const BN_0 = new BigNumber('0');

const MarketMakerAddresses: {
  [identifier: string]: { [network: number]: string[] };
} = {
  ParaswapPool: {
    1: ['0x56178a0d5F301bAf6CF3e1Cd53d9863437345Bf9'],
    56: ['0x06DbC4Fe79e2541b03FE4731B2579c0b7F46f099'],
  },
  ParaswapPool3: {
    1: [
      '0x7bE351f273Ef11892E4125045D363F56Cb755966',
      '0xA5d07E978398eb1715056D3Ca5Cb31035C02fdAD',
      '0x945bcf562085de2d5875b9e2012ed5fd5cfab927',
    ],
    56: ['0x98A2b946CBFf6537601dB6ac0edb0EFf85c36ab2'],
  },
  ParaswapPool4: {
    1: ['0x0000006daea1723962647b7e189d311d757Fb793'],
  },
  ParaswapPool5: {
    1: [
      '0x7b1886e49AB5433bb46f7258548092DC8CdCA28B',
      '0x96AeA3a04627f96A038B348B4D34Ac24dF08820A',
      '0x57845987C8C859D52931eE248D8d84aB10532407',
      '0x6c2d992b7739DFB363a473Cc4F28998b7f1f6dE2',
      '0xdC6D991a6F18471418e28C9249D69f385333f4ac',
      '0x4a45AFD5A9691407B2b8E6Ed8052A511EE7f01E9',
      '0xFC2f592ed0e0447c6c0E75350940fc069c2BA1E6',
      '0xcf9EBECaA4B1581b5566BAACFb6D9933f9849032',
      '0x638C1eF824ACD48E63E6ACC84948f8eAD46f08De',
      '0xF19179ab6cDE7E40CB4d5240F51adfb1744f3671',
      '0x579d0B20609414db74D81B293900470F6D6f035b',
      '0x5874F5F637157f713433D0897BaE58f761f6B8BB',
    ],
  },
  ParaswapPool7: {
    1: [
      '0x632da2Cb89e08449C75E7a4E022189e3D6Af8a2b',
      '0xb3c839dbde6b96d37c56ee4f9dad3390d49310aa',
    ],
  },
  ParaswapPool8: {
    1: ['0xE88CAE87eb5e60b8C834075c78944EA4B9Fa92b6'],
  },
  ParaswapPool9: {
    1: ['0x969378CDB054D9887392B21c84AFaB429029A91A'],
  },
};

type TimeRanges = Array<{
  from: number;
  to?: number;
}>;

type TokenWhitelist = {
  [network: number]: {
    [tokenAddress: string]: TimeRanges;
  };
};

const TokenWhitelist: TokenWhitelist = {
  1: {
    '0x0000000000000000000000000000000000000000': [
      // ETH
      {
        from: 0,
      },
    ],
    '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee': [
      // // ETH
      {
        from: 0,
      },
    ],
    '0x0000000000085d4780b73119b644ae5ecd22b376': [
      // TrueUSD (TUSD)
      {
        from: 0,
      },
    ],
    '0x00c83aecc790e8a4453e5dd3b0b4b3680501a7a7': [
      // SKALE (SKL)
      {
        from: 0,
      },
    ],
    '0x0391d2021f89dc339f60fff84546ea23e337750f': [
      // BarnBridge Governance Token (BOND)
      {
        from: 0,
      },
    ],
    '0x04fa0d235c4abf4bcf4787af4cf447de572ef828': [
      // UMA Voting Token v1 (UMA)
      {
        from: 0,
      },
    ],
    '0x0b38210ea11411557c13457d4da7dc6ea731b88a': [
      // API3 (API3)
      {
        from: 0,
      },
    ],
    '0x0bc529c00c6401aef6d220be8c6ea1667f6ad93e': [
      // yearn.finance (YFI)
      {
        from: 0,
      },
    ],
    '0x0d8775f648430679a709e98d2b0cb6250d2887ef': [
      // BAT (BAT)
      {
        from: 0,
      },
    ],
    '0x0f5d2fb29fb7d3cfee444a200298f468908cc942': [
      // Decentraland (MANA)
      {
        from: 0,
      },
    ],
    '0x111111111117dc0aa78b770fa6a738034120c302': [
      // 1INCH Token (1INCH)
      {
        from: 0,
      },
    ],
    '0x1494ca1f11d487c2bbe4543e90080aeba4ba3c2b': [
      // DefiPulse Index (DPI)
      {
        from: 0,
      },
    ],
    '0x18aaa7115705e8be94bffebde57af9bfc265b998': [
      // Audius (AUDIO)
      {
        from: 0,
      },
    ],
    '0x1f573d6fb3f13d689ff844b4ce37794d79a7ff1c': [
      // Bancor (BNT)
      {
        from: 0,
      },
    ],
    '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984': [
      // Uniswap (UNI)
      {
        from: 0,
      },
    ],
    '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': [
      // Wrapped BTC (WBTC)
      {
        from: 0,
      },
    ],
    '0x2ba592f78db6436527729929aaf6c908497cb200': [
      // Cream (CREAM)
      {
        from: 0,
      },
    ],
    '0x3845badade8e6dff049820680d1f14bd3903a5d0': [
      // SAND (SAND)
      {
        from: 0,
      },
    ],
    '0x408e41876cccdc0f92210600ef50372656052a38': [
      // Republic (REN)
      {
        from: 0,
      },
    ],
    '0x4a220e6096b25eadb88358cb44068a3248254675': [
      // Quant (QNT)
      {
        from: 0,
      },
    ],
    '0x4e15361fd6b4bb609fa63c81a2be19d873717870': [
      // Fantom Token (FTM)
      {
        from: 0,
      },
    ],
    '0x4fabb145d64652a948d72533023f6e7a623c7c53': [
      // Binance USD (BUSD)
      {
        from: 0,
      },
    ],
    '0x4fe83213d56308330ec302a8bd641f1d0113a4cc': [
      // NuCypher (NU)
      {
        from: 0,
      },
    ],
    '0x514910771af9ca656af840dff83e8264ecf986ca': [
      // ChainLink Token (LINK)
      {
        from: 0,
      },
    ],
    '0x58b6a8a3302369daec383334672404ee733ab239': [
      // LivePeer Token (LPT)
      {
        from: 0,
      },
    ],
    '0x6b175474e89094c44da98b954eedeac495271d0f': [
      // Dai Stablecoin (DAI)
      {
        from: 0,
      },
    ],
    '0x6b3595068778dd592e39a122f4f5a5cf09c90fe2': [
      // SushiToken (SUSHI)
      {
        from: 0,
      },
    ],
    '0x6f259637dcd74c767781e37bc6133cd6a68aa161': [
      // HuobiToken (HT)
      {
        from: 0,
      },
    ],
    '0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0': [
      // Matic Token (MATIC)
      {
        from: 0,
      },
    ],
    '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9': [
      // Aave Token (AAVE)
      {
        from: 0,
      },
    ],
    '0x8207c1ffc5b6804f6024322ccf34f29c3541ae26': [
      // OriginToken (OGN)
      {
        from: 0,
      },
    ],
    '0x86772b1409b61c639eaac9ba0acfbb6e238e5f83': [
      // Indexed (NDX)
      {
        from: 0,
      },
    ],
    '0x8e870d67f660d95d5be530380d0ec0bd388289e1': [
      // Pax Dollar (USDP) "Announcement: Paxos Standard (PAX) Token is now rebranded as Pax Dollar (USDP)."
      {
        from: 0,
      },
    ],
    '0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2': [
      // Maker (MKR)
      {
        from: 0,
      },
    ],
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': [
      // USD Coin (USDC)
      {
        from: 0,
      },
    ],
    '0xa3bed4e1c75d00fa6f4e5e6922db7261b5e9acd2': [
      // Meta (MTA)
      {
        from: 0,
      },
    ],
    '0xa47c8bf37f92abed4a126bda807a7b7498661acd': [
      // Wrapped UST Token (UST)
      {
        from: 0,
      },
    ],
    '0xad32a8e6220741182940c5abf610bde99e737b2d': [
      // PieDAO DOUGH v2 (DOUGH)
      {
        from: 0,
      },
    ],
    '0xada0a1202462085999652dc5310a7a9e2bf3ed42': [
      // CoinShares Gold and Cryptoassets Index (CGI)
      {
        from: 0,
      },
    ],
    '0xba100000625a3754423978a60c9317c58a424e3d': [
      // Balancer (BAL)
      {
        from: 0,
      },
    ],
    '0xba11d00c5f74255f56a5e366f4f77f5a186d7f55': [
      // BandToken (BAND)
      {
        from: 0,
      },
    ],
    '0xbbbbca6a901c926f240b89eacb641d8aec7aeafd': [
      // LoopringCoin V2 (LRC)
      {
        from: 0,
      },
    ],
    '0xbc396689893d065f41bc2c6ecbee5e0085233447': [
      // Perpetual (PERP)
      {
        from: 0,
      },
    ],
    '0xc00e94cb662c3520282e6f5717214004a7f26888': [
      // Compound (COMP)
      {
        from: 0,
      },
    ],
    '0xc011a73ee8576fb46f5e1c5751ca3b9fe0af2a6f': [
      // Synthetix Network Token (SNX)
      {
        from: 0,
      },
    ],
    '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': [
      // Wrapped Ether (WETH)
      {
        from: 0,
      },
    ],
    '0xc834fa996fa3bec7aad3693af486ae53d8aa8b50': [
      // Convergence (CONV)
      {
        from: 0,
      },
    ],
    '0xc944e90c64b2c07662a292be6244bdf05cda44a7': [
      // Graph Token (GRT)
      {
        from: 0,
      },
    ],
    '0xd26114cd6ee289accf82350c8d8487fedb8a0c07': [
      // OMG Network (OMG)
      {
        from: 0,
      },
    ],
    '0xd2877702675e6ceb975b4a1dff9fb7baf4c91ea9': [
      // Wrapped LUNA Token (LUNA)
      {
        from: 0,
      },
    ],
    '0xd417144312dbf50465b1c641d016962017ef6240': [
      // Covalent Query Token (CQT)
      {
        from: 0,
      },
    ],
    '0xd533a949740bb3306d119cc777fa900ba034cd52': [
      // Curve DAO Token (CRV)
      {
        from: 0,
      },
    ],
    '0xdac17f958d2ee523a2206206994597c13d831ec7': [
      // Tether USD (USDT)
      {
        from: 0,
      },
    ],
    '0xdd974d5c2e2928dea5f71b9825b8b646686bd200': [
      // KyberNetwork (KNC)
      {
        from: 0,
      },
    ],
    '0xe41d2489571d322189246dafa5ebde1f4699f498': [
      // ZRX (ZRX)
      {
        from: 0,
      },
    ],
    '0xec67005c4e498ec7f55e092bd1d35cbc47c91892': [
      // Melon Token (MLN)
      {
        from: 0,
      },
    ],
    '0xed04915c23f00a313a544955524eb7dbd823143d': [
      // Alchemy (ACH)
      {
        from: 0,
      },
    ],
    '0xf1f955016ecbcd7321c7266bccfb96c68ea5e49b': [
      // Rally (RLY)
      {
        from: 0,
      },
    ],
    '0xf629cbd94d3791c9250152bd8dfbdf380e2a3b9c': [
      // EnjinCoin (ENJ)
      {
        from: 0,
      },
    ],
    '0x123151402076fc819b7564510989e475c9cd93ca': [
      // wrapped-DGLD (wDGLD)
      {
        from: 0,
      },
    ],
    '0x8daebade922df735c38c80c7ebd708af50815faa': [
      // tBTC
      {
        from: 0,
      },
    ],
    '0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce': [
      // SHIBA INU (SHIB)
      {
        from: 0,
      },
    ],
    '0x0000000000095413afc295d19edeb1ad7b71c952': [
      // LON Token (LON)
      {
        from: 0,
      },
    ],
    '0x80fb784b7ed66730e8b1dbd9820afd29931aab03': [
      // EthLend (LEND)
      {
        from: 0,
      },
    ],
    '0x92d6c1e31e14520e676a687f0a93788b716beff5': [
      // dYdX (DYDX)
      {
        from: 0,
      },
    ],
    '0xbb0e17ef65f82ab018d8edd776e8dd940327b28b': [
      //  Axie Infinity Shard (AXS)
      {
        from: 0,
      },
    ],
    '0xcafe001067cdef266afb7eb5a286dcfd277f3de5': [
      //  Paraswap (PSP)
      {
        from: 1637605614,
      },
    ],
  },
};

const isWhitelistedToken = (
  network: number,
  token: string,
  timestamp: number,
) => {
  if (!(network in TokenWhitelist))
    throw new Error(`TokenWhitelist is not exist for network ${network}`);
  if (!(token.toLowerCase() in TokenWhitelist[network])) return false;
  if (!timestamp) return false;

  const ranges = TokenWhitelist[network][token.toLowerCase()];

  return ranges.some(
    ({ from, to }) => timestamp >= from && (to ? timestamp <= to : true),
  );
};

export class VolumeTracker {
  static instances: { [network: number]: VolumeTracker } = {};
  // We can't fetch more than 10000 logs at once
  // we can assume that 5000 blocks will not have
  // more than 10000 0x logs.
  blockFetchHeight: number = 5000;
  isIndexing: boolean = false;

  provider: JsonRpcProvider;
  zeroXV2Contract: Contract;
  zeroXV4Contract: Contract;
  takerAddresses: string[];
  priceApi: PriceApi;
  blockInfo: BlockInfo;
  volumeCache: VolumesCache;
  initBlock: number | null = null;
  marketMakerAddressMap: { [address: string]: string };

  static createInstance(
    initTime: number,
    network: number,
    blockDelay = defaultBlockDelay,
    indexRefreshDelay = defaultIndexRefreshDelay,
  ) {
    if (!VolumeTracker.instances[network]) {
      VolumeTracker.instances[network] = new VolumeTracker(
        initTime,
        network,
        blockDelay,
        indexRefreshDelay,
      );
    }
    return VolumeTracker.instances[network];
  }

  static getInstance(network: number) {
    if (VolumeTracker.instances[network]) {
      return VolumeTracker.instances[network];
    }
    throw new Error(
      `VolumeTracker instance for network ${network} is not yet initialized!`,
    );
  }

  constructor(
    protected initTime: number,
    protected network: number = CHAIN_ID_MAINNET,
    protected blockDelay = defaultBlockDelay,
    protected indexRefreshDelay = defaultIndexRefreshDelay,
  ) {
    this.provider = Provider.getJsonRpcProvider(network);
    this.zeroXV2Contract = new Contract(
      ZeroXV2Address[this.network],
      ZeroXV2Abi,
      this.provider,
    );
    this.zeroXV4Contract = new Contract(
      ZeroXV4Address[this.network],
      ZeroXV4Abi,
      this.provider,
    );
    this.takerAddresses = [
      AugustusV5Address[this.network],
      AugustusV4Address[this.network],
    ].filter(a => !!a);
    this.priceApi = new PriceApi(initTime, this.network);
    this.blockInfo = BlockInfo.getInstance(this.network);
    this.volumeCache = new VolumesCache(this.network);
    this.volumeCache.startGC();
    this.marketMakerAddressMap = Object.entries(MarketMakerAddresses).reduce(
      (acc: { [address: string]: string }, [key, value]) => {
        if (value[this.network]) {
          Object.values(value[this.network]).forEach(
            addr => (acc[addr.toLowerCase()] = key),
          );
        }
        return acc;
      },
      {},
    );
  }

  async indexZeroXV4(
    fromBlock: number,
    toBlock: number,
  ): Promise<VolumeAttributes[]> {
    const rawLogs = await this.zeroXV4Contract.queryFilter(
      this.zeroXV4Contract.filters.RfqOrderFilled(),
      fromBlock,
      toBlock - 1 /* end block is inclusive, so exclude the last block */,
    );

    const filteredLogs = rawLogs.filter(
      log =>
        log.args &&
        this.takerAddresses.some(
          a => a.toLowerCase() === log.args!.taker.toLowerCase(),
        ),
    );
    logger.info(
      `Found ${filteredLogs.length} from ${rawLogs.length} logs for ZeroXV4 ${fromBlock}: ${toBlock}`,
    );

    return await Promise.all(
      filteredLogs.map(async log => {
        const args = log.args!;
        const timestamp = await this.blockInfo.getBlockTimeStamp(
          log.blockNumber,
        );
        if (!timestamp)
          throw new Error('Failed to get block timestamp for record');
        return {
          id: `${log.blockHash}-${log.logIndex}`,
          network: this.network,
          blockNumber: log.blockNumber,
          timestamp,
          makerAddress: args.maker.toLowerCase(),
          takerAddress: args.taker.toLowerCase(),
          fromToken: args.takerToken.toLowerCase(),
          toToken: args.makerToken.toLowerCase(),
          fromVolume: args.takerTokenFilledAmount.toString(),
          fromVolumeUSD: (
            await this._getTokenPrice(
              log.blockNumber,
              args.takerToken,
              new BigNumber(args.takerTokenFilledAmount.toString()),
            )
          ).toFixed(DataType_USD_VALUE_DECIMALS),
          toVolume: args.makerTokenFilledAmount.toString(),
          toVolumeUSD: (
            await this._getTokenPrice(
              log.blockNumber,
              args.makerToken,
              new BigNumber(args.makerTokenFilledAmount.toString()),
            )
          ).toFixed(DataType_USD_VALUE_DECIMALS),
          isWhitelisted:
            isWhitelistedToken(
              this.network,
              args.takerToken.toLowerCase(),
              timestamp,
            ) &&
            isWhitelistedToken(
              this.network,
              args.makerToken.toLowerCase(),
              timestamp,
            ),
        };
      }),
    );
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

  async indexZeroXV2(
    fromBlock: number,
    toBlock: number,
  ): Promise<VolumeAttributes[]> {
    const rawLogs = await this.zeroXV2Contract.queryFilter(
      this.zeroXV2Contract.filters.Fill(),
      fromBlock,
      toBlock - 1 /* end block is inclusive, so exclude the last block */,
    );

    const filteredLogs = rawLogs.filter(
      log =>
        log.args &&
        this.takerAddresses.some(
          a => a.toLowerCase() === log.args!.takerAddress.toLowerCase(),
        ),
    );
    logger.info(
      `Found ${filteredLogs.length} from ${rawLogs.length} logs for ZeroXV2 ${fromBlock}: ${toBlock}`,
    );

    return await Promise.all(
      filteredLogs.map(async log => {
        const args = log.args!;
        const takerToken = '0x' + args.takerAssetData.substring(34); // TODO: do a proper decode
        const makerToken = '0x' + args.makerAssetData.substring(34); // TODO: do a proper decode
        const timestamp = await this.blockInfo.getBlockTimeStamp(
          log.blockNumber,
        );
        if (!timestamp)
          throw new Error('Failed to get block timestamp for record');
        return {
          id: `${log.blockHash}-${log.logIndex}`,
          network: this.network,
          blockNumber: log.blockNumber,
          timestamp,
          makerAddress: args.makerAddress.toLowerCase(),
          takerAddress: args.takerAddress.toLowerCase(),
          fromToken: takerToken.toLowerCase(),
          toToken: makerToken.toLowerCase(),
          fromVolume: args.takerAssetFilledAmount.toString(),
          fromVolumeUSD: (
            await this._getTokenPrice(
              log.blockNumber,
              takerToken,
              new BigNumber(args.takerAssetFilledAmount.toString()),
            )
          ).toFixed(DataType_USD_VALUE_DECIMALS),
          toVolume: args.makerAssetFilledAmount.toString(),
          toVolumeUSD: (
            await this._getTokenPrice(
              log.blockNumber,
              makerToken,
              new BigNumber(args.makerAssetFilledAmount.toString()),
            )
          ).toFixed(DataType_USD_VALUE_DECIMALS),
          isWhitelisted:
            isWhitelistedToken(
              this.network,
              takerToken.toLowerCase(),
              timestamp,
            ) &&
            isWhitelistedToken(
              this.network,
              makerToken.toLowerCase(),
              timestamp,
            ),
        };
      }),
    );
  }

  async indexLatest() {
    if (this.isIndexing) return;
    logger.info(`Indexing started`);
    this.isIndexing = true;
    let reportFailure = true;
    try {
      if (!this.initBlock) {
        this.initBlock = await this.blockInfo.getBlockAfterTimeStamp(
          this.initTime,
        );
        if (!this.initBlock) {
          logger.warn(
            `_indexLatest: unable to fetch block number for ${this.initTime}`,
          );
          return;
        }
      }
      // TODO: handle the case when the last indexing is not completed yet
      const latestBlock = await this.provider.getBlock('latest');
      const maxToBlockNumber = latestBlock.number - this.blockDelay;
      let fromBlock: number, toBlock: number;
      do {
        [fromBlock, toBlock] = await Database.sequelize.transaction(async t => {
          let syncStatuses: VolumeSyncStatus[];
          try {
            syncStatuses = await Database.sequelize.query(
              `SELECT * from "VolumeSyncStatuses" WHERE "network" = ${this.network} FOR UPDATE NOWAIT;`,
              { model: VolumeSyncStatus, transaction: t },
            );
          } catch (e) {
            reportFailure = false;
            logger.info(
              `Unable to lock VolumeSyncStatus for network ${this.network}`,
            );
            throw e;
          }
          if (!syncStatuses.length)
            throw new Error(
              `Didn't find sync status for network ${this.network}`,
            );
          const syncStatus: VolumeSyncStatus = syncStatuses[0];
          syncStatus.fromBlockNumber =
            syncStatus.fromBlockNumber || this.initBlock!;
          syncStatus.toBlockNumber =
            syncStatus.toBlockNumber || this.initBlock!;
          if (
            this.initBlock! < syncStatus.fromBlockNumber ||
            this.initBlock! > syncStatus.toBlockNumber
          ) {
            throw new Error(
              `initBlock not in range of previously synced data on network ${this.network}, you may need to delete the corresponding sync status record to sync from scratch`,
            );
          }

          const fromBlock: number = syncStatus.toBlockNumber;

          if (fromBlock >= maxToBlockNumber) return [fromBlock, fromBlock];

          const toBlock: number =
            fromBlock + this.blockFetchHeight >= maxToBlockNumber
              ? maxToBlockNumber
              : fromBlock + this.blockFetchHeight;

          await Volume.destroy({
            where: {
              network: this.network,
              blockNumber: {
                [Op.gte]: fromBlock,
                [Op.lt]: toBlock,
              },
            },
            transaction: t,
          });

          await this.blockInfo.updateBlockInfo(fromBlock, toBlock);
          const volumes = await Promise.all([
            this.indexZeroXV4(fromBlock, toBlock),
            this.indexZeroXV2(fromBlock, toBlock),
          ]);
          await Volume.bulkCreate(volumes.flat(), {
            validate: true,
            returning: false,
            transaction: t,
          });

          syncStatus.toBlockNumber = toBlock;
          await syncStatus.save({ transaction: t });

          return [fromBlock, toBlock];
        });
        logger.info(`Indexed ${fromBlock}: ${toBlock}`);
      } while (toBlock < maxToBlockNumber);
      logger.info('Indexing completed');
    } catch (e) {
      if (reportFailure) logger.error('Transaction failed', e);
    } finally {
      this.isIndexing = false;
    }
  }

  async getVolumeUSDForBlock(
    _fromBlock?: number,
    _toBlock?: number,
  ): Promise<{ [identifier: string]: string }> {
    if (!this.initBlock) {
      logger.error('getVolumeUSDForBlock: initBlock not initialized');
      return {};
    }

    const syncStatus = await VolumeSyncStatus.findByPk(this.network);
    if (
      !syncStatus ||
      !syncStatus.fromBlockNumber ||
      !syncStatus.toBlockNumber
    ) {
      logger.error('getVolumeUSDForBlock: syncStatus not initialized');
      return {};
    }

    if (
      this.initBlock < syncStatus.fromBlockNumber ||
      this.initBlock > syncStatus.toBlockNumber
    ) {
      logger.error('getVolumeUSDForBlock: initBlock not in synced range');
      return {};
    }

    const fromBlock = _fromBlock || this.initBlock;
    const toBlock = _toBlock || syncStatus.toBlockNumber;

    if (fromBlock < syncStatus.fromBlockNumber) {
      logger.error(
        'getVolumeUSDForBlock: requested fromTime is before synced time',
      );
      return {};
    }

    if (toBlock > syncStatus.toBlockNumber) {
      logger.error(
        'getVolumeUSDForBlock: requested toTime is after synced time',
      );
      return {};
    }

    const volumes = await Volume.scope('whitelisted').findAll({
      attributes: [
        'makerAddress',
        [Sequelize.fn('SUM', Sequelize.col('toVolumeUSD')), 'totalVolumeUSD'],
      ],
      where: {
        network: this.network,
        blockNumber: {
          [Op.gte]: fromBlock,
          [Op.lt]: toBlock,
        },
      },
      group: Sequelize.col('makerAddress'),
    });

    let aggregatedVolume = Object.values(this.marketMakerAddressMap).reduce(
      (acc: { [indentifier: string]: string }, identifier: string) => {
        acc[identifier.toLowerCase()] = '0';
        return acc;
      },
      {},
    );

    volumes.map((volume: Volume) => {
      const identifier =
        this.marketMakerAddressMap[volume.makerAddress]?.toLowerCase();
      if (!identifier) {
        logger.error(
          `getVolumeUSDForBlock: Unable to recognize address ${volume.makerAddress}`,
        );
        return;
      }

      aggregatedVolume[identifier] = new BigNumber(
        (volume as any).getDataValue('totalVolumeUSD') as string,
      )
        .plus(aggregatedVolume[identifier])
        .toFixed(DataType_USD_VALUE_DECIMALS);
    }, {});

    return aggregatedVolume;
  }

  async getVolumeUSD(fromTime?: number, toTime?: number) {
    // aggregate over the volumes
    // TODO: Add aggregation caching
    let fromBlock: number | null | undefined;
    let toBlock: number | null | undefined;
    if (fromTime) {
      fromBlock = await this.blockInfo.getBlockAfterTimeStamp(fromTime);
      if (!fromBlock)
        throw new Error(
          'VolumeTracker_getVolumeUSD: Failed to get block at fromTime',
        );
    }
    if (toTime) {
      toBlock = await this.blockInfo.getBlockAfterTimeStamp(toTime);
      if (!toBlock)
        throw new Error(
          'VolumeTracker_getVolumeUSD: Failed to get block at toTime',
        );
    }
    return this.getVolumeUSDForBlock(
      fromBlock || undefined,
      toBlock || undefined,
    );
  }

  async getVolumeAggregationUSD(period: string) {
    const periodMS = parsePeriod(period);
    if (periodMS === null) throw new Error(`Invalid period "${period}"`);
    if (periodMS > MAX_PERIOD)
      throw new Error(
        `Invalid period: max period is ${moment
          .duration(MAX_PERIOD)
          .asDays()} days`,
      );

    const end = moment();
    const start = moment().subtract(periodMS, 'ms').utc().startOf('day');
    const periods = generatePeriods(start, end);

    return Promise.all(
      periods.map(async (period, i) => {
        const isToday = i === periods.length - 1;
        let volume = this.volumeCache.getDayVolume(period[0]);
        if (!volume || !Object.keys(volume).length || isToday) {
          volume = await (isToday
            ? this.getVolumeUSD(Math.round(period[0] / 1000))
            : this.getVolumeUSD(...period.map(p => Math.round(p / 1000))));
          this.volumeCache.setDayVolume(period[0], volume);
        }

        return {
          start: period[0],
          end: period[1],
          volume: volume,
          periodFormatted: moment(period[0]).utc().format('YYYY-MM-DD'),
        };
      }),
    );
  }

  async startIndexing() {
    await VolumeSyncStatus.findOrCreate({ where: { network: this.network } });
    await this.priceApi.init();
    this.indexLatest();
    setInterval(() => this.indexLatest(), this.indexRefreshDelay);
  }
}

export default VolumeTracker;
