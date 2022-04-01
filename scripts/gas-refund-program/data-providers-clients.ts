import { AxiosError } from 'axios';
import { isNetworkOrIdempotentRequestError } from 'axios-retry';
import { constructHttpClient } from './http-client';

const retryOnRateLimit = (error: AxiosError) => {
  return (
    isNetworkOrIdempotentRequestError(error) || error.response?.status === 429
  );
};

export const coingeckoClient = constructHttpClient({
  axiosConfig: {
    baseURL: 'https://api.coingecko.com/api/v3',
    timeout: 5_000,
  },
  rateLimitOptions: { maxRPS: 1 },
  retryOptions: {
    retryCondition: retryOnRateLimit,
  },
});

export const covalentClient = constructHttpClient({
  axiosConfig: {
    baseURL: 'https://api.covalenthq.com/v1',
    timeout: 60_000,
  },
  rateLimitOptions: { maxRPS: 20 },
  retryOptions: {
    retryCondition: retryOnRateLimit,
  },
});

export const thegraphClient = constructHttpClient({
  axiosConfig: { timeout: 5_000 },
  rateLimitOptions: { maxRPS: 20 },
  retryOptions: {
    retryCondition: retryOnRateLimit,
  },
});
