import {
  JsonRpcBatchProvider,
  JsonRpcProvider,
} from '@ethersproject/providers';
import { Web3Provider } from './constants';
import { retryDecorator } from 'ts-retry-promise';

const TIMEOUT_MS = 10000;
const DELAY_MS = 1000;
const RETRY_ATTEMPTS = 5;
const logger = global.LOGGER('provider');
export class Provider {
  static jsonRpcProviders: { [network: number]: JsonRpcProvider } = {};
  static getJsonRpcProvider(network: number): JsonRpcProvider {
    if (!this.jsonRpcProviders[network]) {
      if (!Web3Provider[network])
        throw new Error(`Provider not defined for network ${network}`);
      this.jsonRpcProviders[network] = new JsonRpcBatchProvider({
        url: Web3Provider[network],
        timeout: TIMEOUT_MS,
      });
      this.jsonRpcProviders[network] = new Proxy(
        this.jsonRpcProviders[network],
        {
          get: (target, prop) => {
            if (prop === 'send') {
              const fn = Reflect.get(target, prop).bind(target);
              return async function send(
                ...args: Parameters<JsonRpcBatchProvider['send']>
              ) {
                return retryDecorator(fn, {
                  retries: RETRY_ATTEMPTS,
                  delay: DELAY_MS,
                  logger: msg => {
                    logger.warn(msg.substring(0, 200));
                  },
                })(...args);
              };
            }
            return Reflect.get(target, prop);
          },
        },
      );
    }

    return this.jsonRpcProviders[network];
  }
}
