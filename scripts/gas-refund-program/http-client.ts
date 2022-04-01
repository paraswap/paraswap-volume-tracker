import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import * as https from 'https';
import axiosRetry, { IAxiosRetryConfig } from 'axios-retry';
import * as _rateLimit from 'axios-rate-limit';

type rateLimitOptions = {
  maxRequests?: number;
  perMilliseconds?: number;
  maxRPS?: number;
};
type AxiosRateLimit = (
  axiosInstance: AxiosInstance,
  options: rateLimitOptions,
) => AxiosInstance;

const rateLimit = _rateLimit as unknown as AxiosRateLimit;

const DEFAULT_HTTP_TIMEOUT = 5_000;
const DEFAULT_RETRY_COUNT = 5;
const DEFAULT_RT_MAX_RPS = 2;
const DEFAULT_RETRY_DELAY = axiosRetry.exponentialDelay;

type RateLimitOptions = {
  maxRequests?: number;
  perMilliseconds?: number;
  maxRPS?: number;
};

type Options = {
  httpsAgent?: https.AgentOptions;
  axiosConfig?: AxiosRequestConfig;
  retryOptions?: IAxiosRetryConfig;
  rateLimitOptions?: RateLimitOptions;
};

export const constructHttpClient = (options?: Options) => {
  const httpsAgent = new https.Agent({
    keepAlive: true,
    ...(options?.httpsAgent || {}),
  });

  const _client = axios.create({
    httpsAgent,
    timeout: DEFAULT_HTTP_TIMEOUT,
    ...(options?.axiosConfig || {}),
    headers: {
      'User-Agent': 'node.js',
      ...(options?.axiosConfig?.headers || {}),
    },
  });

  const client = rateLimit(_client, {
    maxRPS: DEFAULT_RT_MAX_RPS,
    ...(options?.rateLimitOptions || {}),
  });

  axiosRetry(client, {
    retries: DEFAULT_RETRY_COUNT,
    retryDelay: DEFAULT_RETRY_DELAY,
    ...(options?.retryOptions || {}),
  });

  return client;
};
