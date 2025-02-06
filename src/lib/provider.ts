import { JsonRpcProvider } from '@ethersproject/providers';
import { Web3Provider, Web3ProviderArchive } from './constants';
import { retryDecorator } from 'ts-retry-promise';

// these params worked best during indexing
const TIMEOUT_MS = 300000;
const DELAY_MS = 2500;
const RETRY_ATTEMPTS = 5;
const logger = global.LOGGER('provider');
export class Provider {
  static jsonRpcProviders: { [network: number]: JsonRpcProvider } = {};
  static archiveJsonRpcProviders: { [network: number]: JsonRpcProvider } = {};
  static getJsonRpcProvider(network: number): JsonRpcProvider {
    if (!this.jsonRpcProviders[network]) {
      if (!Web3Provider[network])
        throw new Error(`Provider not defined for network ${network}`);
      this.jsonRpcProviders[network] = new JsonRpcProvider({
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
                ...args: Parameters<JsonRpcProvider['send']>
              ) {
                return retryDecorator(fn, {
                  retries: RETRY_ATTEMPTS,
                  delay: DELAY_MS,
                  timeout: TIMEOUT_MS,
                  logger: msg => {
                    logger.warn(msg.substring(0, 200), { network });
                  },
                })(...args);
              };
            }
            return Reflect.get(target, prop);
          },
        },
      );

      // this.jsonRpcProviders[network].on('debug', (info: any) => {
      //   // logger.debug(info);
      // });
    }

    return this.jsonRpcProviders[network];
  }

  // COPY PASTING FROM UP
  static getArchiveJsonRpcProvider(network: number): JsonRpcProvider {
    if (!this.archiveJsonRpcProviders[network]) {
      if (!Web3Provider[network])
        throw new Error(`Provider not defined for network ${network}`);
      this.archiveJsonRpcProviders[network] = new JsonRpcProvider({
        url: Web3ProviderArchive[network],
        timeout: TIMEOUT_MS,
      });
      this.archiveJsonRpcProviders[network] = new Proxy(
        this.archiveJsonRpcProviders[network],
        {
          get: (target, prop) => {
            if (prop === 'send') {
              const fn = Reflect.get(target, prop).bind(target);
              return async function send(
                ...args: Parameters<JsonRpcProvider['send']>
              ) {
                return retryDecorator(fn, {
                  retries: RETRY_ATTEMPTS,
                  delay: DELAY_MS,
                  timeout: TIMEOUT_MS,
                  logger: msg => {
                    logger.warn(msg.substring(0, 200), { network });
                  },
                })(...args);
              };
            }
            return Reflect.get(target, prop);
          },
        },
      );

      // this.jsonRpcProviders[network].on('debug', (info: any) => {
      //   // logger.debug(info);
      // });
    }

    return this.archiveJsonRpcProviders[network];
  }
}
