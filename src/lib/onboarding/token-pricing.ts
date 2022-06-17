import { assert } from 'ts-essentials';
import { coingeckoClient } from '../utils/data-providers-clients';

const PRICE_SEARCH_PAST_WINDOW_LOOKUP = 4 * 60 * 60;

export async function fetchHistoricalPSPPrice(
  timestamp: number,
): Promise<number> {
  const fromUnixDate = timestamp - PRICE_SEARCH_PAST_WINDOW_LOOKUP;
  const toUnixDate = timestamp;

  const apiEndpoint = `/coins/paraswap/market_chart/range?id=paraswap&vs_currency=usd&from=${fromUnixDate}&to=${toUnixDate}`;

  const {
    data: { prices },
  } = await coingeckoClient.get<{
    prices: [date: number, price: number][];
  }>(apiEndpoint);

  prices.sort((a, b) => b[0] - a[0]); // sort desc in timestamp

  const closestPrice = prices[0]?.[1];

  assert(closestPrice, 'no price found within 4 hour range check price api');

  return closestPrice;
}
