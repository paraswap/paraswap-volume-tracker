import { assert } from 'ts-essentials';
import { startOfDay } from 'date-fns';
import {
  CHAIN_ID_AVALANCHE,
  CHAIN_ID_BINANCE,
  CHAIN_ID_FANTOM,
  CHAIN_ID_MAINNET,
  CHAIN_ID_POLYGON,
  PSP_ADDRESS,
} from '../../src/lib/constants';
import { HistoricalPrice } from './types';
import { coingeckoClient } from './data-providers-clients';

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

const projectToStartOfDay = (timestamp: number) =>
  startOfDay(timestamp).getTime();

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
  const url = `/coins/${platformId}/contract/${address}/market_chart/range?vs_currency=usd&from=${startTimestamp}&to=${endTimestamp}`;
  const {
    data: { prices },
  } = await coingeckoClient.get<CoingeckoPriceHistory>(url);

  const accDailyPrices = prices.reduce<
    Record<string, { accRate: number; count: number }>
  >((acc, [timestamp, rate]) => {
    if (!rate) return acc;

    const startOfDaySec = projectToStartOfDay(timestamp);

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
  chainId,
  startTimestamp,
  endTimestamp,
}: {
  chainId: number;
  startTimestamp: number;
  endTimestamp: number;
}) {
  try {
    return await fetchHistoricalPriceCoingecko({
      chainId,
      address: PSP_ADDRESS[chainId],
      startTimestamp,
      endTimestamp,
    });
  } catch {
    return fetchHistoricalPriceCoingecko({
      chainId: CHAIN_ID_MAINNET,
      address: PSP_ADDRESS[CHAIN_ID_MAINNET],
      startTimestamp,
      endTimestamp,
    });
  }
}

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
    fetchDailyPspUsdPrice({ chainId, startTimestamp, endTimestamp }),
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

export const constructSameDayPrice = (prices: HistoricalPrice) => {
  const pricesByDate = prices.reduce<Record<string, number>>((acc, curr) => {
    acc[curr.timestamp] = curr.rate;
    return acc;
  }, {});

  return function findSameDayPrice(unixtime: number) {
    const startOfDayTimestamp = projectToStartOfDay(unixtime * 1000);
    return pricesByDate[startOfDayTimestamp];
  };
};
