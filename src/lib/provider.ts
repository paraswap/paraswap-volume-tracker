import {
  JsonRpcBatchProvider,
  JsonRpcProvider,
} from '@ethersproject/providers';
import { Web3Provider } from './constants';

const TEN_SECONDS_MS = 10 * 1000;
export class Provider {
  static jsonRpcProviders: { [network: number]: JsonRpcProvider } = {};
  static getJsonRpcProvider(network: number): JsonRpcProvider {
    if (!this.jsonRpcProviders[network]) {
      if (!Web3Provider[network])
        throw new Error(`Provider not defined for network ${network}`);
      this.jsonRpcProviders[network] = new JsonRpcBatchProvider({
        url: Web3Provider[network],
        timeout: TEN_SECONDS_MS,
      });
    }

    return this.jsonRpcProviders[network];
  }
}
