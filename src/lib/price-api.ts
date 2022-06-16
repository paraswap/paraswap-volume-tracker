import BigNumber from 'bignumber.js';
import * as _ from 'lodash';
import { Contract } from '@ethersproject/contracts';
import type { JsonRpcProvider } from '@ethersproject/providers';
import {
  CHAIN_ID_MAINNET,
  CHAIN_ID_BINANCE,
  CHAIN_ID_POLYGON,
  CHAIN_ID_AVALANCHE,
  NULL_ADDRESS,
  NATIVE_TOKEN_ADDRESS,
  // ParaswapApiURL,
} from './constants';
import { Provider } from './provider';
import * as ERC20ABI from './abi/erc20.abi.json';
import { coingeckoClient } from './utils/data-providers-clients';

const logger = global.LOGGER();

const platforms: any = {
  [CHAIN_ID_MAINNET]: 'ethereum',
  [CHAIN_ID_BINANCE]: 'binance-smart-chain',
  [CHAIN_ID_POLYGON]: 'polygon-pos',
  [CHAIN_ID_AVALANCHE]: 'avalanche',
};

type TokenInfo = {
  coinGekoId: string;
  decimals: number | undefined;
};

type CoinGekoTokenInfo = {
  id: string;
  symbol: string;
  name: string;
  platforms: { [key: string]: string };
};

const BN_0 = new BigNumber('0');

const NATIVE_TOKENS: { [network: number]: string } = {
  56: 'binancecoin',
  1: 'ethereum',
  43314: 'avalanche-2',
  137: 'polygon',
};

export class PriceApi {
  tokenList: { [address: string]: TokenInfo } = {};
  tokenPrice: { [address: string]: [number, number][] } = {};
  updatingTokenQuery: { [key: string]: Promise<void> } = {};
  provider: JsonRpcProvider;
  erc20Contract: Contract;

  constructor(
    protected initTime: number,
    protected network = CHAIN_ID_MAINNET,
  ) {
    this.provider = Provider.getJsonRpcProvider(network);
    this.erc20Contract = new Contract(NULL_ADDRESS, ERC20ABI, this.provider);
  }

  async fetchTokenList() {
    // fetch token list from the api
    try {
      // const {
      //   data: { tokens },
      // } = await Utils._get(`${ParaswapApiURL}/tokens?network=${this.network}`, 5000);
      // const paraswapListedTokens = _.keyBy(tokens, t =>
      //   t.address.toLowerCase(),
      // );

      const platform = platforms[this.network];
      const { data } = await coingeckoClient.get(
        `/coins/list?include_platform=true&asset_platform_id=${platform}`,
      );

      data.map((d: CoinGekoTokenInfo) => {
        if (!d.platforms[platform]) return;

        const address = d.platforms[platform].toLowerCase();
        // if (!(address in paraswapListedTokens)) return;

        this.tokenList[address] = {
          coinGekoId: d.id,
          decimals: undefined,
        };
      });

      // Coingeko by default doesn't return native token address
      this.tokenList[NATIVE_TOKEN_ADDRESS] = {
        coinGekoId: NATIVE_TOKENS[this.network],
        decimals: undefined,
      };
    } catch (e) {
      logger.error('fetchTokenList', e);
      // This is a critical error, throw it again so indexing won't start!
      // Definitely don't want to be indexing when CoinGecko isn't working
      // and if we have no tokens all volume will become 0.
      throw e;
    }
  }

  // Wraps the _updateTokenPrice such that it can't have multiple
  // concurrent calls for the same token
  async updateTokenPrice(tokenAddress: string) {
    const key = `${tokenAddress}`;
    if (key in this.updatingTokenQuery)
      return await this.updatingTokenQuery[key];

    this.updatingTokenQuery[key] = this._updateTokenPrice(tokenAddress);
    try {
      return await this.updatingTokenQuery[key];
    } finally {
      delete this.updatingTokenQuery[key];
    }
  }

  async _updateTokenPrice(tokenAddress: string) {
    // fetch the token price from init time to present
    const _tokenAddress = tokenAddress.toLowerCase();
    try {
      const fromTime =
        _tokenAddress in this.tokenPrice
        // && this.tokenPrice[_tokenAddress]!.length !== 0 // Always the case
          ? _.last(this.tokenPrice[_tokenAddress])![0] + 1
          : this.initTime;
      const currentTime = Math.floor(Date.now() / 1000);
      const tokeInfo = this.tokenList[_tokenAddress];
      const {
        data: { prices },
      } = await coingeckoClient.get(
        `/coins/${tokeInfo.coinGekoId}/market_chart/range?vs_currency=usd&from=${fromTime}&to=${currentTime}`,
      );
      if (!prices) throw new Error('Invalid coingeko price returned');

      // Take care that prices are not left empty!
      // i.e. don't await between here and the end of the function
      if (!(_tokenAddress in this.tokenPrice))
        this.tokenPrice[_tokenAddress] = [];

      // The timestamp from coingeko are in ms
      const _prices = prices.map((t: [number, number]) => [t[0] / 1000, t[1]]);
      this.tokenPrice[_tokenAddress] = this.tokenPrice[_tokenAddress]!.concat(
        _prices,
      );
    } catch (e) {
      logger.error('_updateTokenPrice', e);
    }
    // If prices are still empty for some reason, delete them
    if (
      _tokenAddress in this.tokenPrice &&
      !this.tokenPrice[_tokenAddress].length
    ) {
      delete this.tokenPrice[_tokenAddress];
    }
  }

  async init() {
    await this.fetchTokenList();
  }

  private async _getTokenDecimals(tokenAddress: string): Promise<number> {
    const _tokenAddress = tokenAddress.toLowerCase();
    if (!this.tokenList[_tokenAddress].decimals) {
      if (NATIVE_TOKEN_ADDRESS.toLowerCase() === _tokenAddress) {
        this.tokenList[_tokenAddress].decimals = 18;
      } else {
        const tokenContract = this.erc20Contract.attach(tokenAddress);
        const decimals = parseInt(
          (await tokenContract.functions.decimals()).toString(),
        );
        this.tokenList[_tokenAddress].decimals = decimals;
      }
    }
    return this.tokenList[_tokenAddress].decimals!;
  }

  async getPriceUSD(
    tokenAddress: string,
    volume: BigNumber,
    time: number,
  ): Promise<BigNumber> {
    const _tokenAddress = tokenAddress.toLowerCase();

    // if the token is not listed by Paraswap or Coingeko take 0 prices
    if (!(_tokenAddress in this.tokenList)) {
      logger.warn(`_getPriceUSD: Unknown token ${_tokenAddress}, returning 0 price`);
      return BN_0;
    }

    if (time < this.initTime) {
      logger.warn(`_getPriceUSD: time should not be less than initTime (${this.initTime} > ${time}), returning 0 price`);
      return BN_0;
    }

    // If the token historical price is not fetched or time is higher that what we have
    // fetched so far, fetch the prices
    if (
      !(_tokenAddress in this.tokenPrice) ||
      _.last(this.tokenPrice[_tokenAddress])![0] + 5 * 60 /*5 mins*/ < time
    )
      await this.updateTokenPrice(_tokenAddress);

    // if the historical prices were fetched but wasn't successful take 0 price
    if (!this.tokenPrice[_tokenAddress]) {
      logger.warn(`_getPriceUSD: Unable to find price for ${_tokenAddress}, returning 0 price`);
      return BN_0;
    }

    // find the timestamp after the given price
    let i = this.tokenPrice[_tokenAddress]!.findIndex(p => p[0] >= time);
    if (i === -1) {
      if (_.last(this.tokenPrice[_tokenAddress]!)![0] + 24 * 60 * 60 /* 1 day */ > time) {
        /* Just use the most recent price if it's less than 1 day old */
        i = this.tokenPrice[_tokenAddress]!.length - 1;
      } else {
        logger.warn(`_getPriceUSD: Invalid Time(${time}) for ${_tokenAddress}, returning 0 price`);
        return BN_0;
      }
    }

    const decimals = await this._getTokenDecimals(tokenAddress);

    return volume
      .times(this.tokenPrice[_tokenAddress]![i][1].toFixed(5))
      .div(new BigNumber(10).pow(decimals));
  }
}
