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
    CurrentEpoch: 1,
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
      poolRewards: {
        [poolAddress: string]: string; // poolAddress must be all in lowercase!!
      }
    };
  };
} = {
  1: {
    0: {
      endBlockNumber: 13708712,
      calcTimeStamp: 1638187200,
      reward: '2500000000000000000000000',
      poolRewards: {
        '0x55a68016910a7bcb0ed63775437e04d2bb70d570': '203015682868967481713265',
        '0xea02df45f56a690071022c45c95c46e7f61d3eab': '1535733555815482353633734',
        '0x6b1d394ca67fdb9c90bbd26fe692dda4f4f53ecd': '418877093653364093502327',
        '0x37b1e4590638a266591a9c11d6f945fe7a1adaa7': '148062142616895333279866',
        '0xc3359dbdd579a3538ea49669002e8e8eea191433': '194311525045290737870806'
      }
    } 
  }
};

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

  getPoolRewards(epoch: number): {[poolAddress: string]: string;} {
    if (epoch >= this.getCurrentEpoch())
      throw new Error('Epoch rewards not send yet');
    return EpochDetails[this.network][epoch].poolRewards;
  }
}