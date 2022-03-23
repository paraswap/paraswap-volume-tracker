import axios from 'axios';
import { assert } from 'ts-essentials';
import {
  CHAIN_ID_AVALANCHE,
  CHAIN_ID_BINANCE,
  CHAIN_ID_FANTOM,
  CHAIN_ID_MAINNET,
  CHAIN_ID_POLYGON,
  PSP_ADDRESS_ETHEREUM,
} from '../../lib/constants';
import { HistoricalPrice } from './types';

const logger = global.LOGGER('GRP:PSP-CHAIN-CURRENCY-PRICING');

type CoingeckoMapping = {
  [chainId: number]: {
    wrappedChainCurrency: string;
    platformId: string;
  };
};

export const COINGECKO_METADATA: CoingeckoMapping = {
  [CHAIN_ID_MAINNET]: {
    wrappedChainCurrency: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    platformId: 'ethereum',
  },
  [CHAIN_ID_BINANCE]: {
    wrappedChainCurrency: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
    platformId: 'binance-smart-chain',
  },
  [CHAIN_ID_POLYGON]: {
    wrappedChainCurrency: '0x0000000000000000000000000000000000001010',
    platformId: 'polygon-pos',
  },
  [CHAIN_ID_AVALANCHE]: {
    wrappedChainCurrency: '0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7',
    platformId: 'avalanche',
  },
  [CHAIN_ID_FANTOM]: {
    wrappedChainCurrency: '0x21be370d5312f44cb42ce377bc9b8a0cef1a4c83',
    platformId: 'fantom',
  },
};

type CoingeckoPriceHistory = {
  prices: [timestamp: number, usdPrice: number][];
};

async function fetchHistoricalPriceCoingecko({
  chainId,
  address,
  startTimestamp,
  endTimestamp,
}: {
  chainId: number;
  address: string;
  startTimestamp: number;
  endTimestamp: number;
}): Promise<HistoricalPrice> {
  const platformId = COINGECKO_METADATA[chainId].platformId;
  const {
    data: { prices },
  } = await axios.get<CoingeckoPriceHistory>(
    `https://api.coingecko.com/api/v3/coins/${platformId}/contract/${address}/market_chart/?vs_currency=usd&days=30`, // Warning max is 30 days
  );

  return prices
    .map(([timestamp, usdPrice]) => ({ timestamp, rate: usdPrice }))
    .filter(
      ({ timestamp }) =>
        timestamp >= startTimestamp && timestamp < endTimestamp,
    );
}

async function fetchDailyChainCurrencyUsdPrice({
  chainId,
  startTimestamp,
  endTimestamp,
}: {
  chainId: number;
  startTimestamp: number;
  endTimestamp: number;
}) {
  return fetchHistoricalPriceCoingecko({
    chainId,
    address: COINGECKO_METADATA[chainId].wrappedChainCurrency,
    startTimestamp,
    endTimestamp,
  });
}

async function fetchDailyPspUsdPrice({
  startTimestamp,
  endTimestamp,
}: {
  startTimestamp: number;
  endTimestamp: number;
}) {
  return fetchHistoricalPriceCoingecko({
    chainId: CHAIN_ID_MAINNET,
    address: PSP_ADDRESS_ETHEREUM,
    startTimestamp,
    endTimestamp,
  });
}

// @FIXME: implementation is not resilient to inconsistent historical data (say coingecko return different granularity)
// @FIXME: make sure prices timestamps starts from startTimestamp could be few minutes delay, prevent code to hop to next day price
export async function fetchDailyPSPChainCurrencyRate({
  chainId,
  startTimestamp,
  endTimestamp,
}: {
  chainId: number;
  startTimestamp: number;
  endTimestamp: number;
}): Promise<HistoricalPrice> {
  const [chainCurPrice, pspPrice] = await Promise.all([
    fetchDailyChainCurrencyUsdPrice({
      startTimestamp,
      endTimestamp,
      chainId,
    }),
    fetchDailyPspUsdPrice({ startTimestamp, endTimestamp }),
  ]);

  assert(chainCurPrice.length > 0, 'could not find any rate');
  assert(
    chainCurPrice.length === pspPrice.length,
    `Invalid price length got: ${chainCurPrice.length} and ${pspPrice.length}`,
  );

  logger.info(`Successfully retrieved ${chainCurPrice.length} prices`);

  return chainCurPrice.map((chainCurPrice, i) => ({
    timestamp: chainCurPrice.timestamp,
    rate: pspPrice[i].rate / chainCurPrice.rate,
  }));
}
