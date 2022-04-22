import * as pMemoize from 'p-memoize';
import * as QuickLRU from 'quick-lru';
import {
  CHAIN_TO_COIN_ID,
  CoingeckoPriceHistory,
  computeDailyAvgLast24h,
  fetchHistoricalPriceCoingecko,
  PSP_COINGECKO_COIN_ID,
  sampleDailyAvgPricesStartOfDay,
} from './coingecko';
import { startOfDayMilliSec } from '../utils';

const fetchHistoricalPriceCoingeckoCached = pMemoize(
  fetchHistoricalPriceCoingecko,
  {
    cacheKey: args => JSON.stringify(args[0]),
    cache: new QuickLRU({
      maxSize: 5, // cache all supported chain prices + PSP
    }),
  },
);

type PricesAtTimestamp = {
  pspToChainCurRate: number;
  chainPrice: number;
  pspPrice: number;
};
type PricesByTimestamp = {
  [timestamp: string]: PricesAtTimestamp;
};

type HistoricalTokenUsdPrices = {
  chainCurrencyHistoricalPrices: CoingeckoPriceHistory;
  pspHistoricalPrices: CoingeckoPriceHistory;
};

export async function fetchDailyPSPChainCurrencyRate({
  chainId,
  startTimestamp,
  endTimestamp,
}: {
  chainId: number;
  startTimestamp: number;
  endTimestamp: number;
}): Promise<HistoricalTokenUsdPrices> {
  const [chainCurrencyHistoricalPrices, pspHistoricalPrices] =
    await Promise.all([
      fetchHistoricalPriceCoingeckoCached({
        startTimestamp,
        endTimestamp,
        coinId: CHAIN_TO_COIN_ID[chainId],
      }),
      fetchHistoricalPriceCoingeckoCached({
        startTimestamp,
        endTimestamp,
        coinId: PSP_COINGECKO_COIN_ID,
      }),
    ]);

  return { chainCurrencyHistoricalPrices, pspHistoricalPrices };
}

export type PriceResolverFn = (unixtime: number) => PricesAtTimestamp;

// Deprecated algo but still used for older epoch (<11)
const constructSameDayPriceResolver = (
  prices: HistoricalTokenUsdPrices,
): PriceResolverFn => {
  const dailyAvgChainCurPrice = sampleDailyAvgPricesStartOfDay(
    prices.chainCurrencyHistoricalPrices,
  );
  const dailyAvgPspPrice = sampleDailyAvgPricesStartOfDay(
    prices.pspHistoricalPrices,
  );

  const aggregatedPrices = Object.keys(
    dailyAvgChainCurPrice,
  ).reduce<PricesByTimestamp>((acc, timestamp) => {
    const pspPrice = dailyAvgPspPrice[timestamp];
    const chainPrice = dailyAvgChainCurPrice[timestamp];
    const pspToChainCurRate = pspPrice / chainPrice;

    acc[timestamp] = { pspToChainCurRate, chainPrice, pspPrice };

    return acc;
  }, {});

  return function findSameDayPrice(unixtime: number) {
    const startOfDayTimestamp = startOfDayMilliSec(unixtime * 1000);
    return aggregatedPrices[startOfDayTimestamp];
  };
};

// computes moving average prices for last 24h 
const constructLast24hAvgPriceResolver = (
  prices: HistoricalTokenUsdPrices,
): PriceResolverFn => {
  return function resolveLast24hAvgPrice(unixTime: number) {
    const avgChainCurrencyPrice = computeDailyAvgLast24h(
      prices.chainCurrencyHistoricalPrices,
      unixTime * 1000,
    );
    const avgPSPPrice = computeDailyAvgLast24h(
      prices.pspHistoricalPrices,
      unixTime * 1000,
    );

    return {
      pspToChainCurRate: avgPSPPrice / avgChainCurrencyPrice,
      chainPrice: avgChainCurrencyPrice,
      pspPrice: avgPSPPrice,
    };
  };
};

export const constructPriceResolver = (
  prices: HistoricalTokenUsdPrices,
  mode: 'sameDay' | 'last24h',
): PriceResolverFn => {
  return mode === 'sameDay'
    ? constructSameDayPriceResolver(prices)
    : constructLast24hAvgPriceResolver(prices);
};
