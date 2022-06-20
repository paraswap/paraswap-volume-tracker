import { assert } from 'ts-essentials';
import { URLSearchParams } from 'url';
import { coingeckoClient } from '../utils/data-providers-clients';

const PRICE_SEARCH_PAST_WINDOW_LOOKUP = 4 * 60 * 60;
const { COINGECKO_API_KEY } = process.env;

export async function fetchHistoricalPSPPrice(
  timestamp: number,
): Promise<number> {
  const fromUnixDate = timestamp - PRICE_SEARCH_PAST_WINDOW_LOOKUP;
  const toUnixDate = timestamp;

  const queryString = new URLSearchParams({
    id: 'paraswap',
    vs_currency: 'usd',
    from: fromUnixDate.toString(),
    to: toUnixDate.toString(),
    ...(!!COINGECKO_API_KEY && { x_cg_pro_api_key: COINGECKO_API_KEY }),
  }).toString();

  const apiEndpoint = `/coins/paraswap/market_chart/range?${queryString}`;

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
