import { assert } from 'ts-essentials';
import { HistoricalPrice } from '../types';
import * as pMemoize from 'p-memoize';
import * as QuickLRU from 'quick-lru';
import {
  CHAIN_TO_COIN_ID,
  fetchAvgDailyPrice,
  PSP_COINGECKO_COIN_ID,
} from './coingecko';
import { startOfDayMilliSec } from '../utils';

const logger = global.LOGGER('GRP:PSP-CHAIN-CURRENCY-PRICING');

const fetchAvgDailyPriceCached = pMemoize(fetchAvgDailyPrice, {
  cacheKey: args => JSON.stringify(args[0]),
  cache: new QuickLRU({
    maxSize: 5, // cache all supported chain prices + PSP
  }),
});

type PricesAtTimestamp = {
  pspToChainCurRate: number;
  chainPrice: number;
  pspPrice: number;
};
type PricesByTimestamp = {
  [timestamp: string]: PricesAtTimestamp;
};

export async function fetchDailyPSPChainCurrencyRate({
  chainId,
  startTimestamp,
  endTimestamp,
}: {
  chainId: number;
  startTimestamp: number;
  endTimestamp: number;
}): Promise<PricesByTimestamp> {
  const [dailyAvgChainCurPrice, dailyAvgPspPrice] = await Promise.all([
    fetchAvgDailyPriceCached({
      startTimestamp,
      endTimestamp,
      coinId: CHAIN_TO_COIN_ID[chainId],
    }),
    fetchAvgDailyPriceCached({
      startTimestamp,
      endTimestamp,
      coinId: PSP_COINGECKO_COIN_ID,
    }),
  ]);

  const kdailyAvgChainCurPrice = Object.keys(dailyAvgChainCurPrice).length;
  const kdailyAvgPspPrice = Object.keys(dailyAvgPspPrice).length;
  assert(kdailyAvgChainCurPrice > 0, 'could not find any rate');
  assert(
    kdailyAvgChainCurPrice === kdailyAvgPspPrice,
    `Invalid price length got: ${kdailyAvgChainCurPrice} and ${kdailyAvgPspPrice}`,
  );
  logger.info(`Successfully retrieved ${kdailyAvgChainCurPrice} prices`);

  const combinedPrices = Object.keys(
    dailyAvgChainCurPrice,
  ).reduce<PricesByTimestamp>((acc, timestamp) => {
    const pspPrice = dailyAvgPspPrice[timestamp];
    const chainPrice = dailyAvgChainCurPrice[timestamp];
    const pspToChainCurRate = pspPrice / chainPrice;

    acc[timestamp] = { pspToChainCurRate, chainPrice, pspPrice };

    return acc;
  }, {});

  return combinedPrices;
}

export type FindSameDayPrice = (unixtime: number) => PricesAtTimestamp;

export const constructSameDayPrice = (
  prices: PricesByTimestamp,
): FindSameDayPrice => {
  return function findSameDayPrice(unixtime: number) {
    const startOfDayTimestamp = startOfDayMilliSec(unixtime * 1000);
    return prices[startOfDayTimestamp];
  };
};
