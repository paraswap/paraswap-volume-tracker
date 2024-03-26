import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios';
import * as https from 'https';
import axiosRetry, {
  IAxiosRetryConfig,
  isNetworkOrIdempotentRequestError,
} from 'axios-retry';
import * as _rateLimit from 'axios-rate-limit';
import { IAxiosCacheAdapterOptions, setupCache } from 'axios-cache-adapter';
// @ts-ignore // was yelling at missing types, then an issue with ES mods
const axiosCurlirize = require('axios-curlirize');

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
const DEFAULT_RETRY_COND = function retryOnRateLimit(error: AxiosError) {
  return (
    isNetworkOrIdempotentRequestError(error) ||
    error.response?.status === 429 ||
    error.code === 'ECONNABORTED'
  );
};

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
  cacheOptions?: IAxiosCacheAdapterOptions;
};

export const constructHttpClient = (options?: Options) => {
  const httpsAgent = new https.Agent({
    keepAlive: true,
    ...(options?.httpsAgent || {}),
  });

  const cache = options?.cacheOptions ? setupCache(options.cacheOptions) : null;

  const _client = axios.create({
    httpsAgent,
    timeout: DEFAULT_HTTP_TIMEOUT,
    ...(options?.axiosConfig || {}),
    ...(cache ? { adapter: cache.adapter } : {}),
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
    retryCondition: DEFAULT_RETRY_COND,
    shouldResetTimeout: true,
    ...(options?.retryOptions || {}),
  });

  if (process.env.NODE_ENV === 'development') axiosCurlirize(client);

  return client;
};
