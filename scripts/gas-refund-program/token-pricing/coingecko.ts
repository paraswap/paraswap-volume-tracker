import {
  CHAIN_ID_BINANCE,
  CHAIN_ID_FANTOM,
  CHAIN_ID_MAINNET,
  CHAIN_ID_POLYGON,
} from '../../../src/lib/constants';
import { HistoricalPrice } from '../types';
import { coingeckoClient } from '../data-providers-clients';
import { startOfDayMilliSec } from '../utils';
import { assert } from 'ts-essentials';

export const PSP_COINGECKO_COIN_ID = 'paraswap';

type ChainsCoinIds = 'ethereum' | 'binancecoin' | 'fantom' | 'matic-network';

type ChainToCoin = {
  [chainId: number]: ChainsCoinIds;
};

export const CHAIN_TO_COIN_ID: ChainToCoin = {
  [CHAIN_ID_MAINNET]: 'ethereum',
  [CHAIN_ID_BINANCE]: 'binancecoin',
  [CHAIN_ID_POLYGON]: 'matic-network',
  [CHAIN_ID_FANTOM]: 'fantom',
};

export type CoingeckoPriceHistory = [timestamp: number, usdPrice: number][];

export async function fetchHistoricalPriceCoingecko({
  coinId,
  startTimestamp,
  endTimestamp,
}: {
  coinId: typeof PSP_COINGECKO_COIN_ID | ChainsCoinIds;
  startTimestamp: number;
  endTimestamp: number;
}): Promise<CoingeckoPriceHistory> {
  const url = `/coins/${coinId}/market_chart/range?vs_currency=usd&from=${startTimestamp}&to=${endTimestamp}`;
  const {
    data: { prices },
  } = await coingeckoClient.get<{ prices: CoingeckoPriceHistory }>(url);

  return prices;
}

export function sampleDailyAvgPricesStartOfDay(
  prices: CoingeckoPriceHistory,
): HistoricalPrice {
  const accDailyPrices = prices.reduce<
    Record<string, { accRate: number; count: number }>
  >((acc, [timestamp, rate]) => {
    if (!rate) return acc;

    const startOfDaySec = startOfDayMilliSec(timestamp);

    const { accRate, count } = acc[startOfDaySec] || { accRate: 0, count: 0 };

    acc[startOfDaySec] = {
      accRate: accRate + rate,
      count: count + 1,
    };

    return acc;
  }, {});

  const dailyAvgPrice = Object.fromEntries(
    Object.entries(accDailyPrices).map(([timestamp, { accRate, count }]) => [
      timestamp,
      accRate / count,
    ]),
  );

  return dailyAvgPrice;
}

export function computeDailyAvgLast24h(
  prices: CoingeckoPriceHistory,
  endTimestamp: number,
): number {
  const { accRate, count } = prices.reduce<{ accRate: number; count: number }>(
    (acc, [timestamp, rate]) => {
      if (
        !rate ||
        timestamp > endTimestamp ||
        timestamp < endTimestamp - 24 * 60 * 60 * 1000
      )
        return acc;

      const { accRate, count } = acc;

      acc = {
        accRate: accRate + rate,
        count: count + 1,
      };

      return acc;
    },
    { accRate: 0, count: 0 },
  );

  assert(accRate, 'accRate should be greater than 0');
  assert(count, 'count should be greater than 0');

  return accRate / count;
}
