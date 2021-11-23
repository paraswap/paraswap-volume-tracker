import { JsonRpcProvider } from '@ethersproject/providers';
import { Web3Provider } from './constants';

export class Provider {
  static jsonRpcProviders: { [network: number]: JsonRpcProvider } = {};
  static getJsonRpcProvider(network: number): JsonRpcProvider {
    if (!this.jsonRpcProviders[network]) {
      if (!Web3Provider[network])
        throw new Error(`Provider not defined for network ${network}`);
      this.jsonRpcProviders[network] = new JsonRpcProvider(
        Web3Provider[network],
      );
    }
    return this.jsonRpcProviders[network];
  }
}
