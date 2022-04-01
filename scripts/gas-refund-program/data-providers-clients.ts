import { constructHttpClient } from './http-client';

export const coingeckoClient = constructHttpClient({
  axiosConfig: {
    baseURL: 'https://api.coingecko.com/api/v3',
    timeout: 5_000,
  },
  rateLimitOptions: {
    maxRequests: 1,
    perMilliseconds: 10_000,
  },
});

export const covalentClient = constructHttpClient({
  axiosConfig: {
    baseURL: 'https://api.covalenthq.com/v1',
    timeout: 60_000,
  },
  rateLimitOptions: {
    maxRequests: 20,
    perMilliseconds: 2_000,
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
