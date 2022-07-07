/* eslint-disable */
import axios from 'axios';
import { SERVICE_CONFIGURATION_SERVICE_HTTP } from '../env';
import { sleep } from './utils';
import { ApplicationError } from '../errors';
import { CHAIN_ID_MAINNET } from '../lib/constants';

const serviceName = 'volumetracker';

export const CORS_ALLOWED_HEADERS = 'Accept, Content-Type, Origin';
export const REQUEST_BODY_SIZE_LIMIT_BYTES = 256 * 1024; // 256KB
export const CACHE_CONTROL_PREFLIGHT_REQUESTS_MAX_AGE_SECS = 24 * 60 * 60; // 24 hours

const CONFIG_SERVICE_TIMEOUT = 5000;
const CONFIG_SERVICE_RETRY_INTERVAL = 3000;

export type NetworkMap<T> = { [network: number]: T };

export type Config = {
  network: number;
  augustusAddress: string;
  augustusV4Address: string;
  pspAddress: string;
  isStaking: boolean;
  rewardDistributionAddress: string;
  safetyModuleAddress: string;
  privateHttpArchiveProvider: string;
  coinGeckoPlatform: string;
  multicallV2Address: string;
  volumeTrackerInitTime: number;
};

type GlobalConfig = {
  apiKeyCoingecko: string;
  covalentV1ApiKey: string;
  covalentV1HttpUrl: string;
  apiPrefineryHttp: string;
  apiKeyPrefinery: string;
  apiAplcapiHttp: string;
  apiKeyAplcapi: string;
  databaseUrl: string;
  apiKeyCaptcha: string;
  apiKeySubmitAccount: string;
};

type ConfigResponse = {
  networks: NetworkMap<Config>;
  global: GlobalConfig;
};

class ConfigLoader {
  public byNetwork: NetworkMap<Config> = {};

  public enabledNetworks: number[] = [];

  public global?: GlobalConfig;

  public isLoaded: Promise<void>;

  public hasStartedNotifier?: (value: void | PromiseLike<void>) => void;

  constructor() {
    this.isLoaded = new Promise(resolve => {
      this.hasStartedNotifier = resolve;
    });
  }

  async load() {
    console.log(`Try to get config from ${SERVICE_CONFIGURATION_SERVICE_HTTP}`);
    while (true) {
      try {
        const configs = (
          await axios.get<ConfigResponse>(
            `${SERVICE_CONFIGURATION_SERVICE_HTTP}/configuration?service=${serviceName}`,
            { timeout: CONFIG_SERVICE_TIMEOUT },
          )
        ).data;
        this.global = configs.global;
        for (const network in configs.networks) {
          const config = configs.networks[network];
          this.byNetwork[network] = config;
        }
        this.enabledNetworks.push(CHAIN_ID_MAINNET);
        break;
      } catch (e) {
        console.error('Error downloading configuration:', e);
      }
      await sleep(CONFIG_SERVICE_RETRY_INTERVAL);
    }
    console.log(`received config`);
  }

  getConfig(network: number): Config {
    const config = this.byNetwork[network];
    if (!config) {
      throw new ApplicationError(`Missing config for network ${network}`);
    }
    return config;
  }

  getGlobalConfig(): GlobalConfig {
    if (!this.global) {
      throw new ApplicationError(`Missing global config`);
    }
    return this.global;
  }
}
export const configLoader = new ConfigLoader();

export const init = async () => {
  await configLoader.load();
  configLoader.hasStartedNotifier!();
};
