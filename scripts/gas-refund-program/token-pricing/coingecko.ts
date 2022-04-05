import {
  CHAIN_ID_BINANCE,
  CHAIN_ID_FANTOM,
  CHAIN_ID_MAINNET,
  CHAIN_ID_POLYGON,
} from '../../../src/lib/constants';
import { HistoricalPrice } from '../types';
import { coingeckoClient } from '../data-providers-clients';
import { startOfDay } from 'date-fns';

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

type CoingeckoPriceHistory = [timestamp: number, usdPrice: number][];

async function fetchHistoricalPriceCoingecko({
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

function sampleDailyAvgPrices(prices: CoingeckoPriceHistory): HistoricalPrice {
  const accDailyPrices = prices.reduce<
    Record<string, { accRate: number; count: number }>
  >((acc, [timestamp, rate]) => {
    if (!rate) return acc;

    const startOfDaySec = startOfDay(timestamp).getTime();

    const { accRate, count } = acc[startOfDaySec] || { accRate: 0, count: 0 };

    acc[startOfDaySec] = {
      accRate: accRate + rate,
      count: count + 1,
    };

    return acc;
  }, {});

  const dailyAvgPrice = Object.entries(accDailyPrices).map(
    ([timestamp, { accRate, count }]) => ({
      timestamp: +timestamp,
      rate: accRate / count,
    }),
  );

  return dailyAvgPrice;
}

export function fetchAvgDailyPrice({
  coinId,
  startTimestamp,
  endTimestamp,
}: {
  coinId: typeof PSP_COINGECKO_COIN_ID | ChainsCoinIds;
  startTimestamp: number;
  endTimestamp: number;
}): Promise<HistoricalPrice> {
  return fetchHistoricalPriceCoingecko({
    coinId,
    startTimestamp,
    endTimestamp,
  }).then(sampleDailyAvgPrices);
}
