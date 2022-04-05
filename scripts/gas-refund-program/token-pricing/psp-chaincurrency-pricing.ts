import { assert } from 'ts-essentials';
import { startOfDay } from 'date-fns';
import { HistoricalPrice } from '../types';
import * as pMemoize from 'p-memoize';
import * as QuickLRU from 'quick-lru';
import {
  CHAIN_TO_COIN_ID,
  fetchAvgDailyPrice,
  PSP_COINGECKO_COIN_ID,
} from './coingecko';

const logger = global.LOGGER('GRP:PSP-CHAIN-CURRENCY-PRICING');

const fetchAvgDailyPriceCached = pMemoize(fetchAvgDailyPrice, {
  cacheKey: (...args) => JSON.stringify(args),
  cache: new QuickLRU({
    maxSize: 5, // cache all supported chain prices + PSP
  }),
});

export async function fetchDailyPSPChainCurrencyRate({
  chainId,
  startTimestamp,
  endTimestamp,
}: {
  chainId: number;
  startTimestamp: number;
  endTimestamp: number;
}): Promise<HistoricalPrice> {
  const [dailyAvgChainCurPrice, dailyAvgPspPrice] = await Promise.all([
    fetchAvgDailyPriceCached({
      startTimestamp,
      endTimestamp,
      coinId: PSP_COINGECKO_COIN_ID,
    }),
    fetchAvgDailyPriceCached({
      startTimestamp,
      endTimestamp,
      coinId: CHAIN_TO_COIN_ID[chainId],
    }),
  ]);

  assert(dailyAvgChainCurPrice.length > 0, 'could not find any rate');
  assert(
    dailyAvgChainCurPrice.length === dailyAvgPspPrice.length,
    `Invalid price length got: ${dailyAvgChainCurPrice.length} and ${dailyAvgPspPrice.length}`,
  );

  logger.info(`Successfully retrieved ${dailyAvgChainCurPrice.length} prices`);

  const dailyAvgPSPToChainCurPrice = dailyAvgChainCurPrice.map(
    (chainCurPrice, i) => ({
      timestamp: chainCurPrice.timestamp,
      rate: dailyAvgPspPrice[i].rate / chainCurPrice.rate,
    }),
  );

  return dailyAvgPSPToChainCurPrice;
}

export const constructSameDayPrice = (prices: HistoricalPrice) => {
  const pricesByDate = prices.reduce<Record<string, number>>((acc, curr) => {
    acc[curr.timestamp] = curr.rate;
    return acc;
  }, {});

  return function findSameDayPrice(unixtime: number) {
    const startOfDayTimestamp = startOfDay(unixtime * 1000).getTime();
    return pricesByDate[startOfDayTimestamp];
  };
};
