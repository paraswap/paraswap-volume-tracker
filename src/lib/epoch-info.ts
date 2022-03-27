import { retry } from 'ts-retry-promise';
import { Contract } from '@ethersproject/contracts';
import { id } from '@ethersproject/hash';
import * as RewardDistributionAbi from './abi/reward-distribution.abi.json';
import {
  CHAIN_ID_ROPSTEN,
  CHAIN_ID_MAINNET,
  RewardDistributionAddress,
} from './constants';
import { BlockInfo } from './block-info';
import { Provider } from './provider';

const logger = global.LOGGER();

export type StakingSetting = {
  CurrentPSPEpochReward: string;
  EpochDuration: number;
  BlockDelay: number;
  GenesisBlockNumber: number;
};

export const StakingSettings: {
  [network: number]: StakingSetting;
} = {
  [CHAIN_ID_MAINNET]: {
    CurrentPSPEpochReward: '750000000000000000000000',
    EpochDuration: 14 * 60 * 60 * 24,
    BlockDelay: 7,
    GenesisBlockNumber: 13620219, // This is start of the epoch 0
  },
  [CHAIN_ID_ROPSTEN]: {
    CurrentPSPEpochReward: '750000000000000000000000',
    EpochDuration: 14 * 60 * 60 * 24,
    BlockDelay: 10,
    GenesisBlockNumber: 11348236, // This is start of the epoch 0
  },
};

type EpochDetailsInfo = {
  endBlockNumber: number;
  calcTimeStamp: number;
  reward: string;
  poolRewards: {
    [poolAddress: string]: string; // poolAddress must be all in lowercase!!
  };
};

type EpochDetailsI = {
  [epoch: number]: EpochDetailsInfo;
};

const EpochPollingTime = 1 * 60 * 1000; // 1min

export class EpochInfo {
  epochDetails: EpochDetailsI = {};
  currentEpoch: number | null = null;

  private blockInfo: BlockInfo;
  private rewardDistribution: Contract;

  constructor(protected network: number, lazy: boolean = false) {
    this.blockInfo = BlockInfo.getInstance(this.network);
    const provider = Provider.getJsonRpcProvider(this.network);
    this.rewardDistribution = new Contract(
      RewardDistributionAddress[this.network],
      RewardDistributionAbi,
      provider,
    );

    if (lazy) return;

    const getEpochInfo = () =>
      retry(() => this.getEpochDetails(), { retries: 5 });

    getEpochInfo().catch(e => {
      logger.error(`Exit on epoch info update error: ${e.message}`);
      process.exit(1);
    });

    setInterval(getEpochInfo, EpochPollingTime);
  }

  static instances: { [network: number]: EpochInfo } = {};

  static getInstance(network: number, lazy: boolean = false): EpochInfo {
    if (!this.instances[network])
      this.instances[network] = new EpochInfo(network, lazy);
    return this.instances[network];
  }

  async getEpochDetails() {
    try {
      const [currentEpoch] =
        await this.rewardDistribution.functions.currentEpoch();
      if (this.currentEpoch && this.currentEpoch >= currentEpoch.toNumber())
        return;
      for (let i = 0; i < currentEpoch.toNumber(); i++) {
        const epochHistory =
          await this.rewardDistribution.functions.epochHistory(i);
        const eventBlockNumber = epochHistory.sendBlockNumber.toNumber();
        const events = await this.rewardDistribution.queryFilter(
          this.rewardDistribution.filters.RewardDistribution(),
          eventBlockNumber,
          eventBlockNumber,
        );

        if (events.length !== 1)
          throw new Error('Expected exactly one event for the epoch');

        this.epochDetails[i] = this.parseEpochDetailsLog(
          events[0],
          epochHistory,
        );
      }

      this.currentEpoch = currentEpoch.toNumber();
    } catch (e) {
      logger.error(`Get Epoch Details Error: ${e.message}`);
      throw e;
    }
  }

  parseEpochDetailsLog(log: any, epochHistory: any): EpochDetailsInfo {
    return {
      endBlockNumber: log.blockNumber,
      calcTimeStamp: epochHistory.calcTimestamp.toNumber(),
      reward: log.args.poolAmounts
        .reduce((acc: any, el: any) => acc.add(el))
        .toString(),
      poolRewards: log.args.poolAddresses.reduce(
        (poolRewards: any, poolAddress: string, i: number) => {
          poolRewards[poolAddress.toLowerCase()] =
            log.args.poolAmounts[i].toString();
          return poolRewards;
        },
        {},
      ),
    };
  }

  getCurrentEpoch(): number {
    if (!this.currentEpoch) throw new Error('currentEpoch not set');
    return this.currentEpoch;
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
    return this.epochDetails[epoch].calcTimeStamp;
  }

  getEpochEndBlock(epoch: number): number {
    return this.epochDetails[epoch].endBlockNumber;
  }

  getCurrentPSPPoolReward(): string {
    return StakingSettings[this.network].CurrentPSPEpochReward;
  }

  getEpochDuration(): number {
    return StakingSettings[this.network].EpochDuration;
  }

  getPSPPoolReward(epoch: number): string {
    if (epoch == this.getCurrentEpoch()) return this.getCurrentPSPPoolReward();
    return this.epochDetails[epoch].reward;
  }

  getPoolRewards(epoch: number): { [poolAddress: string]: string } {
    if (epoch >= this.getCurrentEpoch())
      throw new Error('Epoch rewards not send yet');
    return this.epochDetails[epoch].poolRewards;
  }
}
