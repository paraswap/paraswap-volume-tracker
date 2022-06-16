import { assert } from 'ts-essentials';
import { startOfHourSec } from '../utils/helpers';
import { constructHttpClient } from '../utils/http-client';

const PRICE_SEARCH_PAST_WINDOW_LOOKUP = 4 * 60 * 60;

const tokenPricingServiceClient = constructHttpClient({
  cacheOptions: {
    maxAge: 30 * 60 * 1000, // can go for long cache
    limit: 1000,
    exclude: {
      query: false, // to force cache segmentation by interval (from, to)
    },
  },
  rateLimitOptions: {
    maxRPS: 6, // 8req/sec according to https://www.coingecko.com/en/api_terms
  },
});

export async function fetchHistoricalPSPPrice(
  timestamp: number,
): Promise<number> {
  const fromUnixDate = startOfHourSec(
    timestamp - PRICE_SEARCH_PAST_WINDOW_LOOKUP,
  );
  const toUnixDate = timestamp;

  const url = `https://api.coingecko.com/api/v3/coins/paraswap/market_chart/range?id=paraswap&vs_currency=usd&from=${fromUnixDate}&to=${toUnixDate}`;

  const {
    data: { prices },
  } = await tokenPricingServiceClient.get<{
    prices: [date: number, price: number][];
  }>(url);

  prices.sort((a, b) => b[0] - a[0]); // sort desc in timestamp

  const closestPrice = prices[0]?.[1];

  assert(closestPrice, 'no price found within 4 hour range check price api');

  return closestPrice;
}
