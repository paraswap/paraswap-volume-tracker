import {
  CHAIN_ID_ROPSTEN,
  CHAIN_ID_MAINNET,
} from './constants';
import { BlockInfo } from './block-info';

export type StakingSetting = {
  CurrentPSPEpochReward: string;
  EpochDuration: number;
  BlockDelay: number;
  GenesisBlockNumber: number;
  CurrentEpoch: number;
};

export const StakingSettings: {
  [network: number]: StakingSetting;
} = {
  [CHAIN_ID_MAINNET]: {
    CurrentPSPEpochReward: '2500000000000000000000000',
    EpochDuration: 14 * 60 * 60 * 24,
    BlockDelay: 7,
    GenesisBlockNumber: 13620219, // This is start of the epoch 0
    CurrentEpoch: 0,
  },
  [CHAIN_ID_ROPSTEN]: {
    CurrentPSPEpochReward: '2500000000000000000000000',
    EpochDuration: 14 * 60 * 60 * 24,
    BlockDelay: 10,
    GenesisBlockNumber: 11348236, // This is start of the epoch 0
    CurrentEpoch: 0,
  },
};

// TODO: automate this
// The blocknumber at which the epoch reward is sent.
export const EpochDetails: {
  [network: number]: {
    [epoch: number]: {
      endBlockNumber: number;
      calcTimeStamp: number;
      reward: string;
    };
  };
} = {};

export class EpochInfo {
  private blockInfo: BlockInfo;

  constructor(protected network: number) {
    this.blockInfo = BlockInfo.getInstance(this.network);
  }

  static instances: {[network: number]: EpochInfo} = {};

  static getInstance(network: number): EpochInfo {
    if(!this.instances[network]) 
      this.instances[network] = new EpochInfo(network);
    return this.instances[network];
  }

  getCurrentEpoch(): number {
    return StakingSettings[this.network].CurrentEpoch;
  }

  getEpochStartBlock(epoch: number): number {
    return epoch < 1
      ? StakingSettings[this.network].GenesisBlockNumber
      : this.getEpochEndBlock(epoch - 1);
  }

  async getEpochStartCalcTime(epoch: number): Promise<number> {
    if (epoch === 0) {
      const epochStartTime = await this.blockInfo.getBlockTimeStamp(
        StakingSettings[this.network].GenesisBlockNumber,
      );
      if (!epochStartTime)
        throw new Error(
          `Unable to fetch the timestamp for network: ${this.network} block: ${
            StakingSettings[this.network].GenesisBlockNumber
          }`,
        );
      return epochStartTime;
    } else {
      return this.getEpochEndCalcTime(epoch - 1);
    }
  }

  getEpochEndCalcTime(epoch: number): number {
    return EpochDetails[this.network][epoch].calcTimeStamp;
  }

  getEpochEndBlock(epoch: number): number {
    return EpochDetails[this.network][epoch].endBlockNumber;
  }

  getCurrentPSPPoolReward(): string {
    return StakingSettings[this.network].CurrentPSPEpochReward;
  }

  getEpochDuration(): number {
    return StakingSettings[this.network].EpochDuration;
  }

  getPSPPoolReward(epoch: number): string {
    if (epoch == this.getCurrentEpoch())
      return this.getCurrentPSPPoolReward();
    return EpochDetails[this.network][epoch].reward;
  }
}