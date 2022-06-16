import { constructHttpClient } from './http-client';

export const coingeckoClient = constructHttpClient({
  axiosConfig: {
    baseURL: 'https://api.coingecko.com/api/v3',
    timeout: 5_000,
  },
  rateLimitOptions: {
    maxRPS: undefined, // to override default maxRPS
    maxRequests: 40, // theorically max is 50 req/min according to https://www.coingecko.com/en/api/pricing but gets 429s at exact upper bound
    perMilliseconds: 60_000,
  },
});

export const covalentClient = constructHttpClient({
  axiosConfig: {
    baseURL: 'https://api.covalenthq.com/v1',
    timeout: 30_000,
  },
  rateLimitOptions: {
    maxRPS: 5,
  },
});

export const thegraphClient = constructHttpClient({
  axiosConfig: {
    timeout: 5_000,
  },
  rateLimitOptions: {
    maxRPS: 20,
  },
});
