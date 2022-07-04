import { JsonRpcProvider } from '@ethersproject/providers';
import { configLoader, NetworkMap } from '../config';

export class Provider {
  static jsonRpcProviders: NetworkMap<JsonRpcProvider> = {};

  static getJsonRpcProvider(network: number): JsonRpcProvider {
    const config = configLoader.getConfig(network);

    if (!this.jsonRpcProviders[network]) {
      if (!config.privateHttpArchiveProvider)
        throw new Error(`Provider not defined for network ${network}`);
      this.jsonRpcProviders[network] = new JsonRpcProvider(config.privateHttpArchiveProvider);
    }
    return this.jsonRpcProviders[network];
  }
}
