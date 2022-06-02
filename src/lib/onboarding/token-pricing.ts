import { coingeckoClient } from '../utils/data-providers-clients';

export async function fetchSpotPSPUsdPrice(): Promise<number> {
  const url = `https://api.coingecko.com/api/v3/coins/paraswap?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`;
  const {
    data: {
      market_data: {
        current_price: { usd },
      },
    },
  } = await coingeckoClient.get<{
    market_data: { current_price: { usd: number } };
  }>(url);

  return usd;
}
