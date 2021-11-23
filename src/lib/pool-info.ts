import type { JsonRpcProvider } from '@ethersproject/providers';
import { Contract } from '@ethersproject/contracts';
import { Interface } from '@ethersproject/abi';
import {
  MULTICALL_ADDRESS,
  DEFAULT_CHAIN_ID,
  CHAIN_ID_ROPSTEN,
  CHAIN_ID_MAINNET,
  STAKING_CHAIN_IDS,
} from './constants';
import { Provider } from './provider';
import * as MultiCallerABI from './abi/multicaller.abi.json';
import * as ERC20ABI from './abi/erc20.abi.json';
import * as SPSPABI from './abi/spsp.abi.json';
import BigNumber from 'bignumber.js';
import volumeTracker from './volume-tracker';
import { BlockInfo } from './block-info';

export enum PoolType {
  AMMPool = 'AMMPool',
  MarketMakerPool = 'MarketMakerPool',
}

type UnderlyingTokenInfo = {
  tokens: {
    address: string;
    percent: number;
  }[];
  DEXName: string; // [Balancer, UniswapV2, etc]
};

type PoolConfig = {
  address: string;
  underlyingTokenAddress: string;
  type: PoolType;
  name: string;
  marketMakerIdentifier: string;
  poolReleaseBlockNumber: number;
  underlyingTokenInfo?: UnderlyingTokenInfo;
  isActive: boolean;
};

export type StakingPoolInfo = {
  currentBlockNumber: number;
  currentEpoch: number;
  totalStakedUnderlyingToken: {
    current: string;
    lastEpoch: string | null;
  };
  totalMarketMakerTradeVolume: {
    current: string;
    lastEpoch: string | null;
  };
  totalMarketMakerTradeVolumeAveragedDaily: {
    current: string;
    lastEpoch: string | null;
  };
  averagePoolAPY: {
    current: string;
    lastEpoch: string | null;
  };
  PSPPrice: {
    current: string | null;
    lastEpoch: string | null;
  };
  epochStartTime: {
    current: number;
    lastEpoch: number | null;
  };
  epochEndTime: {
    current: number;
    lastEpoch: number | null;
  };
  projectedVolumes: string[];
  pools: {
    address: string;
    underlyingTokenAddress: string;
    type: PoolType; // [AMMPool, MarketMakerPool]
    name: string;
    totalValueLocked: {
      current: string | null;
      lastEpoch: string | null;
    };
    stakedUnderlyingToken: {
      current: string;
      lastEpoch: string | null;
    };
    APY: {
      current: string;
      lastEpoch: string | null;
    };
    projectedAPY: string[];
    underlyingTokenInfo?: UnderlyingTokenInfo;
    marketMakerInfo?: {
      name: string;
      tradedVolume: {
        current: string;
        lastEpoch: string | null;
      };
      tradedVolumeAveragedDaily: {
        current: string;
        lastEpoch: string | null;
      };
    };
  }[];
};

type PoolComputedState = {
  totalValueLocked: string | null;
  stakedUnderlyingToken: string;
  APY: string;
  projectedAPY: string[];
  marketMakerTradedVolume: string;
  marketMakerTradedVolumeAveragedDaily: string;
};

type AggregatedPoolState = {
  totalStakedUnderlyingToken: string;
  totalMarketMakerTradeVolume: string;
  totalMarketMakerTradeVolumeAveragedDaily: string;
  averagePoolAPY: string;
  PSPPrice: string | null;
  epochStartTime: number;
  epochEndTime: number;
};

type CompletePoolState = {
  poolStateMap: { [poolAddress: string]: PoolComputedState };
  aggregatedPoolState: AggregatedPoolState;
};

type OnChainPoolState = {
  underlyingTokenLocked: bigint;
  underlyingTokenBalance: bigint;
  poolTokenTotalSupply: bigint;
  timeLockBlocks: number;
};

const PoolConfigsMap: { [network: number]: PoolConfig[] } = {
  [CHAIN_ID_ROPSTEN]: [
    {
      name: 'ParaSwapPool1',
      address: '0x60402d0018bFa960e75d70D7671293BB4fA5bb33',
      underlyingTokenAddress: '0xd3f80dfa27a803e5de3b4a08150692f9462297e4',
      type: PoolType.MarketMakerPool,
      marketMakerIdentifier: 'ParaswapPool',
      poolReleaseBlockNumber: 11253673,
      isActive: true,
    },
    {
      name: 'ParaSwapPool2',
      address: '0xFB00942071623bd0766A01794025d0d7FD3F8F1D',
      underlyingTokenAddress: '0xd3f80dfa27a803e5de3b4a08150692f9462297e4',
      type: PoolType.MarketMakerPool,
      marketMakerIdentifier: 'ParaswapPool2',
      poolReleaseBlockNumber: 11253673,
      isActive: false,
    },
    {
      name: 'ParaSwapPool3',
      address: '0x856e4a97bF555d9e8cb53D3b8341F93884af9aF2',
      underlyingTokenAddress: '0xd3f80dfa27a803e5de3b4a08150692f9462297e4',
      type: PoolType.MarketMakerPool,
      marketMakerIdentifier: 'ParaswapPool3',
      poolReleaseBlockNumber: 11253673,
      isActive: true,
    },
    {
      name: 'ParaSwapPool4',
      address: '0x75635e0b419683896BFE83F4A175B4F7ba70F952',
      underlyingTokenAddress: '0xd3f80dfa27a803e5de3b4a08150692f9462297e4',
      type: PoolType.MarketMakerPool,
      marketMakerIdentifier: 'ParaswapPool4',
      poolReleaseBlockNumber: 11253673,
      isActive: true,
    },
    {
      name: 'ParaSwapPool5',
      address: '0xD04504CD7f47ca9431a7A23b43fCC0e9E647D466',
      underlyingTokenAddress: '0xd3f80dfa27a803e5de3b4a08150692f9462297e4',
      type: PoolType.MarketMakerPool,
      marketMakerIdentifier: 'ParaswapPool5',
      poolReleaseBlockNumber: 11253673,
      isActive: false,
    },
    {
      name: 'ParaSwapPool6',
      address: '0x6bDA531A9C610caC7a0229372532ED3c13233797',
      underlyingTokenAddress: '0xd3f80dfa27a803e5de3b4a08150692f9462297e4',
      type: PoolType.MarketMakerPool,
      marketMakerIdentifier: 'ParaswapPool6',
      poolReleaseBlockNumber: 11253673,
      isActive: false,
    },
    {
      name: 'ParaSwapPool7',
      address: '0x1490832d701AceF24A938984E6a2D78A98de6207',
      underlyingTokenAddress: '0xd3f80dfa27a803e5de3b4a08150692f9462297e4',
      type: PoolType.MarketMakerPool,
      marketMakerIdentifier: 'ParaswapPool7',
      poolReleaseBlockNumber: 11253673,
      isActive: true,
    },
  ],
  [CHAIN_ID_MAINNET]: [
    {
      name: 'ParaSwapPool1',
      address: '0x55A68016910A7Bcb0ed63775437e04d2bB70D570',
      underlyingTokenAddress: '0xcafe001067cdef266afb7eb5a286dcfd277f3de5',
      type: PoolType.MarketMakerPool,
      marketMakerIdentifier: 'ParaswapPool',
      poolReleaseBlockNumber: 13619800,
      isActive: true,
    },
    {
      name: 'ParaSwapPool3',
      address: '0xea02DF45f56A690071022c45c95c46E7F61d3eAb',
      underlyingTokenAddress: '0xcafe001067cdef266afb7eb5a286dcfd277f3de5',
      type: PoolType.MarketMakerPool,
      marketMakerIdentifier: 'ParaswapPool3',
      poolReleaseBlockNumber: 13619806,
      isActive: true,
    },
    {
      name: 'ParaSwapPool4',
      address: '0x6b1D394Ca67fDB9C90BBd26FE692DdA4F4f53ECD',
      underlyingTokenAddress: '0xcafe001067cdef266afb7eb5a286dcfd277f3de5',
      type: PoolType.MarketMakerPool,
      marketMakerIdentifier: 'ParaswapPool4',
      poolReleaseBlockNumber: 13619811,
      isActive: true,
    },
    {
      name: 'ParaSwapPool7',
      address: '0x37b1E4590638A266591a9C11d6f945fe7A1adAA7',
      underlyingTokenAddress: '0xcafe001067cdef266afb7eb5a286dcfd277f3de5',
      type: PoolType.MarketMakerPool,
      marketMakerIdentifier: 'ParaswapPool7',
      poolReleaseBlockNumber: 13619812,
      isActive: true,
    },
    {
      name: 'ParaSwapPool9',
      address: '0xC3359DbdD579A3538Ea49669002e8E8eeA191433',
      underlyingTokenAddress: '0xcafe001067cdef266afb7eb5a286dcfd277f3de5',
      type: PoolType.MarketMakerPool,
      marketMakerIdentifier: 'ParaswapPool9',
      poolReleaseBlockNumber: 13631761,
      isActive: true,
    },
  ],
};

type StakingSetting = {
  CurrentPSPEpochReward: string;
  EpochDuration: number;
  BlockDelay: number;
  BlockUpdateInterval: number;
  GenesisBlockNumber: number;
  CurrentEpoch: number;
};
const StakingSettings: {
  [network: number]: StakingSetting;
} = {
  [CHAIN_ID_MAINNET]: {
    CurrentPSPEpochReward: '2500000000000000000000000',
    EpochDuration: 14 * 60 * 60 * 24,
    BlockDelay: 7,
    BlockUpdateInterval: 3000,
    GenesisBlockNumber: 13620219, // This is start of the epoch 0
    CurrentEpoch: 0,
  },
  [CHAIN_ID_ROPSTEN]: {
    CurrentPSPEpochReward: '2500000000000000000000000',
    EpochDuration: 14 * 60 * 60 * 24,
    BlockDelay: 10,
    BlockUpdateInterval: 3000,
    GenesisBlockNumber: 11348236, // This is start of the epoch 0
    CurrentEpoch: 0,
  },
};

// TODO: automate this
// The blocknumber at which the epoch reward is sent.
const EpochDetails: {
  [network: number]: {
    [epoch: number]: {
      endBlockNumber: number;
      calcTimeStamp: number;
      reward: string;
    };
  };
} = {};

const PSPDecimals = 18;
const DayDuration = 60 * 60 * 24;

const ProjectedVolumes = [1, 2, 3, 4, 5, 6, 7].map(e => new BigNumber(10).pow(e + PSPDecimals));
const ProjectedVolumesStr = ProjectedVolumes.map(p => p.toFixed());

export class PoolInfo {
  static instances: { [network: number]: PoolInfo } = {};

  multicallContract: Contract;
  erc20Interface: Interface;
  spspInterface: Interface;
  provider: JsonRpcProvider;
  poolStates: { [blockNumber: number]: CompletePoolState };
  volumeTracker = volumeTracker; // TODO: make this network specific in future
  private latestBlockNumber: number;
  private latestBlockTimestamp: number;
  private blockInfo: BlockInfo;

  private constructor(
    private network: number,
    private poolConfigs: PoolConfig[],
  ) {
    this.provider = Provider.getJsonRpcProvider(this.network);
    this.multicallContract = new Contract(
      MULTICALL_ADDRESS[this.network],
      MultiCallerABI,
      this.provider,
    );
    this.erc20Interface = new Interface(ERC20ABI);
    this.spspInterface = new Interface(SPSPABI);
    this.poolStates = {};
    this.blockInfo = BlockInfo.getInstance(this.network);
  }

  static getInstance(network: number = DEFAULT_CHAIN_ID) {
    if (!(network in this.instances))
      this.instances[network] = new PoolInfo(
        network,
        PoolConfigsMap[network].filter(p => p.isActive),
      );
    return this.instances[network];
  }

  private async setLatestBlockNumber() {
    const latestBlock = await this.provider.getBlock('latest');
    this.latestBlockNumber =
      latestBlock.number - StakingSettings[this.network].BlockDelay;
  }

  static initStartListening() {
    return Promise.all(
      STAKING_CHAIN_IDS.map(network =>
        PoolInfo.getInstance(network).startListening(),
      ),
    );
  }

  async startListening() {
    setInterval(
      this.setLatestBlockNumber.bind(this),
      StakingSettings[this.network].BlockUpdateInterval,
    );
    await this.setLatestBlockNumber();
  }

  private async fetchOnChainPoolStates(
    blockNumber: Number,
    poolConfigs: PoolConfig[],
  ): Promise<OnChainPoolState[]> {
    const multiCallData = poolConfigs
      .map(p => {
        if (p.type !== PoolType.MarketMakerPool)
          throw `PoolType Not Supported ${p.address}:${p.type}`;
        return [
          {
            target: p.address,
            callData: this.spspInterface.encodeFunctionData('pspsLocked'),
          },
          {
            target: p.underlyingTokenAddress,
            callData: this.erc20Interface.encodeFunctionData('balanceOf', [
              p.address,
            ]),
          },
          {
            target: p.address,
            callData: this.spspInterface.encodeFunctionData('totalSupply'),
          },
          {
            target: p.address,
            callData: this.spspInterface.encodeFunctionData('timeLockBlocks'),
          },
        ];
      })
      .flat();

    const rawResult = await this.multicallContract.functions.aggregate(
      multiCallData,
      { blockTag: blockNumber },
    );
    let i = 0;

    return poolConfigs.map(p => ({
      underlyingTokenLocked: BigInt(
        this.spspInterface
          .decodeFunctionResult('pspsLocked', rawResult.returnData[i++])
          .toString(),
      ),
      underlyingTokenBalance: BigInt(
        this.erc20Interface
          .decodeFunctionResult('balanceOf', rawResult.returnData[i++])
          .toString(),
      ),
      poolTokenTotalSupply: BigInt(
        this.spspInterface
          .decodeFunctionResult('totalSupply', rawResult.returnData[i++])
          .toString(),
      ),
      timeLockBlocks: parseInt(
        this.spspInterface
          .decodeFunctionResult('timeLockBlocks', rawResult.returnData[i++])
          .toString(),
      ),
    }));
  }

  async getCurrentEpochRewardParams(
    calcTimeStamp: number,
    epochReward: string = StakingSettings[this.network].CurrentPSPEpochReward,
  ): Promise<{
    addresses: string[];
    amounts: string[];
    calcTimeStamp: number;
    epochReward: string;
    volumes: string[];
    stakes: string[];
    blockNumber: number;
  }> {
    const currentEpoch = this.getCurrentEpoch();
    const epochCalcStartTime = await this.getEpochStartCalcTime(currentEpoch);

    const marketMakerVolumeMap = await this.volumeTracker.getVolumeUSD(
      epochCalcStartTime,
      calcTimeStamp,
    );
    if (!Object.keys(marketMakerVolumeMap).length)
      throw new Error('Unable to fetch marketMakerVolumes');

    const marketMakerVolumes = this.poolConfigs.map(
      p => marketMakerVolumeMap[p.marketMakerIdentifier.toLowerCase()] || '0',
    );

    const epochEndBlockNumber = await this.blockInfo.getBlockAfterTimeStamp(
      calcTimeStamp,
    );
    if (!epochEndBlockNumber)
      throw new Error(
        `Unable to fetch the blockNumber for network: ${this.network} timestamp: ${calcTimeStamp}`,
      );

    const onChainPoolStates = await this.fetchOnChainPoolStates(
      epochEndBlockNumber,
      this.poolConfigs,
    );

    const stakes = onChainPoolStates.map(s =>
      (s.underlyingTokenBalance - s.underlyingTokenLocked).toString(),
    );

    const amounts = this.calculatePoolRewards(
      marketMakerVolumes,
      stakes,
      epochReward,
    ).map(a => a.toFixed(0));

    const addresses = this.poolConfigs.map(p => p.address);

    return {
      volumes: marketMakerVolumes,
      stakes,
      addresses,
      amounts,
      calcTimeStamp,
      epochReward,
      blockNumber: epochEndBlockNumber,
    };
  }

  private async getAllPoolStates(epoch: number): Promise<CompletePoolState> {
    if (epoch < 0)
      return {
        poolStateMap: {},
        aggregatedPoolState: {
          totalStakedUnderlyingToken: '0',
          totalMarketMakerTradeVolume: '0',
          totalMarketMakerTradeVolumeAveragedDaily: '0',
          averagePoolAPY: '0',
          PSPPrice: '0',
          epochStartTime: 0,
          epochEndTime: 0,
        },
      };

    const isCurrentEpoch = epoch === this.getCurrentEpoch();

    const blockNumber = isCurrentEpoch
      ? this.latestBlockNumber
      : this.getEpochEndBlock(epoch);

    if (blockNumber in this.poolStates) return this.poolStates[blockNumber];

    const epochStartCalcTime = await this.getEpochStartCalcTime(epoch);

    const epochEndCalcTime = isCurrentEpoch
      ? undefined
      : this.getEpochEndCalcTime(epoch);

    const epochReward = isCurrentEpoch
      ? StakingSettings[this.network].CurrentPSPEpochReward
      : this.getReward(epoch);

    // TODO: handle different pool types
    const poolConfigs = this.poolConfigs.filter(
      p =>
        p.type === PoolType.MarketMakerPool &&
        p.poolReleaseBlockNumber <= blockNumber,
    );

    const marketMakerVolumeMap = await this.volumeTracker.getVolumeUSD(
      epochStartCalcTime,
      <undefined | number>epochEndCalcTime,
    );
    if (!Object.keys(marketMakerVolumeMap).length)
      throw new Error('Unable to fetch marketMakerVolumes');

    const marketMakerVolumes = poolConfigs.map(
      p => marketMakerVolumeMap[p.marketMakerIdentifier.toLowerCase()] || '0',
    );

    const onChainPoolStates = await this.fetchOnChainPoolStates(
      blockNumber,
      poolConfigs,
    );

    const PSPPrice = await this.getPSPPrice(blockNumber);

    const { poolAPYs, projectedPoolAPYs } = this.calculatePoolAPYs(
      marketMakerVolumes,
      onChainPoolStates,
      epochReward,
    );

    const currentTime = Math.floor(Date.now() / 1000);
    // We use 1hr as min spentEpochDurationDays to avoid division with small number
    const spentEpochDurationDays = isCurrentEpoch
      ? currentTime - epochStartCalcTime < DayDuration / 24
        ? 1 / 24
        : (currentTime - epochStartCalcTime) / DayDuration
      : (epochEndCalcTime! - epochStartCalcTime) / DayDuration;
    // Warning: This assumes we just have one underlying token. This might change in future
    let totalStakedUnderlyingToken = BigInt(0);
    let totalMarketMakerTradeVolume = new BigNumber(0);
    const poolStateMap = poolConfigs.reduce(
      (
        acc: { [poolAddress: string]: PoolComputedState },
        p: PoolConfig,
        i: number,
      ) => {
        const stakedUnderlyingToken =
          onChainPoolStates[i].underlyingTokenBalance -
          onChainPoolStates[i].underlyingTokenLocked;
        totalStakedUnderlyingToken += stakedUnderlyingToken;
        totalMarketMakerTradeVolume = totalMarketMakerTradeVolume.plus(
          marketMakerVolumes[i],
        );
        acc[p.address.toLowerCase()] = {
          totalValueLocked: PSPPrice
            ? new BigNumber(stakedUnderlyingToken.toString())
                .times(PSPPrice)
                .div(10 ** PSPDecimals)
                .toFixed(3)
            : null,
          stakedUnderlyingToken: stakedUnderlyingToken.toString(),
          APY: poolAPYs[i].toFixed(3),
          projectedAPY: projectedPoolAPYs[i].map(a => a.toFixed(3)),
          marketMakerTradedVolume: marketMakerVolumes[i],
          marketMakerTradedVolumeAveragedDaily: new BigNumber(
            marketMakerVolumes[i],
          )
            .div(spentEpochDurationDays)
            .toFixed(3),
        };
        return acc;
      },
      {},
    );
    const EpochDurationDays =
      StakingSettings[this.network].EpochDuration / (60 * 60 * 24);
    const averagePoolAPY = new BigNumber(epochReward)
      .times(100)
      .times(365 / EpochDurationDays)
      .div(totalStakedUnderlyingToken.toString());

    const completeState = {
      poolStateMap,
      aggregatedPoolState: {
        totalStakedUnderlyingToken: totalStakedUnderlyingToken.toString(),
        totalMarketMakerTradeVolume: totalMarketMakerTradeVolume.toFixed(3),
        totalMarketMakerTradeVolumeAveragedDaily: totalMarketMakerTradeVolume
          .div(spentEpochDurationDays)
          .toFixed(3),
        averagePoolAPY: averagePoolAPY.toFixed(3),
        PSPPrice: PSPPrice ? PSPPrice.toFixed(3) : null,
        epochStartTime: epochStartCalcTime,
        epochEndTime:
          epochEndCalcTime ||
          epochStartCalcTime + StakingSettings[this.network].EpochDuration,
      },
    };

    this.poolStates[blockNumber] = completeState;
    return completeState;
  }

  private calculatePoolRewards(
    marketMakerVolumes: string[],
    poolStakedUnderlyingTokens: string[],
    epochReward: string,
  ): BigNumber[] {
    const weights = marketMakerVolumes.map((m, i) =>
      new BigNumber(m).times(poolStakedUnderlyingTokens[i]).squareRoot(),
    );
    const sumWeight = weights.reduce((sum, w) => sum.plus(w), new BigNumber(0));
    const rewards = weights.map(w => w.times(epochReward).div(sumWeight));
    return rewards;
  }

  private calculatePoolProjectedRewards(
    marketMakerVolumes: string[],
    poolStakedUnderlyingTokens: string[],
    epochReward: string,
  ): BigNumber[][] {
    const baseWeights = marketMakerVolumes.map((m, i) =>
      new BigNumber(m).times(poolStakedUnderlyingTokens[i]).squareRoot(),
    );
    const baseSumWeight = baseWeights.reduce((sum, w) => sum.plus(w), new BigNumber(0));
    const projectedRewards = poolStakedUnderlyingTokens.map((s, i) => ProjectedVolumes.map(v => {
      const currentWeight = new BigNumber(marketMakerVolumes[i]).times(v.plus(s)).squareRoot();
      return currentWeight.times(epochReward).div(baseSumWeight.minus(baseWeights[i]).plus(currentWeight));
    }));
    return projectedRewards;
  }

  private calculatePoolAPYs(
    marketMakerVolumes: string[],
    onChainPoolStates: OnChainPoolState[],
    epochReward: string,
  ): {poolAPYs: BigNumber[], projectedPoolAPYs: BigNumber[][]} {
    const poolStakedUnderlyingTokens = onChainPoolStates.map(s =>
      (s.underlyingTokenBalance - s.underlyingTokenLocked).toString(),
    );
    const rewards = this.calculatePoolRewards(
      marketMakerVolumes,
      poolStakedUnderlyingTokens,
      epochReward,
    );
    const projectedRewards = this.calculatePoolProjectedRewards(
      marketMakerVolumes,
      poolStakedUnderlyingTokens,
      epochReward,
    );

    const EpochDurationDays =
      StakingSettings[this.network].EpochDuration / (60 * 60 * 24);
    const factor = new BigNumber(100).times(365 / EpochDurationDays);
    const poolAPYs = rewards.map((r, i) =>
      poolStakedUnderlyingTokens[i] == '0'
        ? new BigNumber(0)
        : r.times(factor).div(poolStakedUnderlyingTokens[i]),
    );

    const BN0 = new BigNumber(0);

    const projectedPoolAPYs = projectedRewards.map(
      (poolRewards, i) => poolRewards.map(
        (r, j) => poolStakedUnderlyingTokens[i] == '0' && ProjectedVolumes[j].eq(BN0)
        ? new BigNumber(0)
        : r.times(factor).div(ProjectedVolumes[j].plus(poolStakedUnderlyingTokens[i]))

    ))
    return { poolAPYs, projectedPoolAPYs };
  }

  private async getPSPPrice(blockNumber: number): Promise<number | null> {
    // TODO: replace null wth some pricing source
    return null;
  }

  private getCurrentEpoch(): number {
    return StakingSettings[this.network].CurrentEpoch;
  }

  private getEpochStartBlock(epoch: number): number {
    return epoch < 1
      ? StakingSettings[this.network].GenesisBlockNumber
      : this.getEpochEndBlock(epoch - 1);
  }

  private async getEpochStartCalcTime(epoch: number): Promise<number> {
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

  private getEpochEndCalcTime(epoch: number): number {
    return EpochDetails[this.network][epoch].calcTimeStamp;
  }

  private getEpochEndBlock(epoch: number): number {
    return EpochDetails[this.network][epoch].endBlockNumber;
  }

  private getReward(epoch: number): string {
    return EpochDetails[this.network][epoch].reward;
  }

  async getLatestPoolData(): Promise<StakingPoolInfo> {
    const currentEpoch = this.getCurrentEpoch();
    const currentState = await this.getAllPoolStates(currentEpoch);
    const lastEpochState = await this.getAllPoolStates(currentEpoch - 1);
    const isZeroEpoch = currentEpoch === 0;
    return {
      currentEpoch,
      currentBlockNumber: this.latestBlockNumber,
      totalStakedUnderlyingToken: {
        current: currentState.aggregatedPoolState.totalStakedUnderlyingToken,
        lastEpoch: isZeroEpoch
          ? null
          : lastEpochState.aggregatedPoolState.totalStakedUnderlyingToken,
      },
      totalMarketMakerTradeVolume: {
        current: currentState.aggregatedPoolState.totalMarketMakerTradeVolume,
        lastEpoch: isZeroEpoch
          ? null
          : lastEpochState.aggregatedPoolState.totalMarketMakerTradeVolume,
      },
      totalMarketMakerTradeVolumeAveragedDaily: {
        current:
          currentState.aggregatedPoolState
            .totalMarketMakerTradeVolumeAveragedDaily,
        lastEpoch: isZeroEpoch
          ? null
          : lastEpochState.aggregatedPoolState
              .totalMarketMakerTradeVolumeAveragedDaily,
      },
      averagePoolAPY: {
        current: currentState.aggregatedPoolState.averagePoolAPY,
        lastEpoch: isZeroEpoch
          ? null
          : lastEpochState.aggregatedPoolState.averagePoolAPY,
      },
      PSPPrice: {
        current: currentState.aggregatedPoolState.PSPPrice,
        lastEpoch: isZeroEpoch
          ? null
          : lastEpochState.aggregatedPoolState.PSPPrice,
      },
      epochStartTime: {
        current: currentState.aggregatedPoolState.epochStartTime,
        lastEpoch: isZeroEpoch
          ? null
          : lastEpochState.aggregatedPoolState.epochStartTime,
      },
      epochEndTime: {
        current: currentState.aggregatedPoolState.epochEndTime,
        lastEpoch: isZeroEpoch
          ? null
          : lastEpochState.aggregatedPoolState.epochEndTime,
      },
      projectedVolumes: ProjectedVolumesStr,
      pools: this.poolConfigs.map(p => {
        const currentPState =
          currentState.poolStateMap[p.address.toLowerCase()];
        // pool might not be released in the previous epoch hence it might be undefined in poolStateMap
        const lastEpochPState =
          lastEpochState.poolStateMap[p.address.toLowerCase()];
        const isNewPool = !lastEpochState;
        return {
          address: p.address,
          underlyingTokenAddress: p.underlyingTokenAddress,
          type: p.type,
          name: p.name,
          totalValueLocked: {
            current: currentPState.totalValueLocked,
            lastEpoch:
              isZeroEpoch || isNewPool
                ? null
                : lastEpochPState.totalValueLocked,
          },
          stakedUnderlyingToken: {
            current: currentPState.stakedUnderlyingToken,
            lastEpoch:
              isZeroEpoch || isNewPool
                ? null
                : lastEpochPState.stakedUnderlyingToken,
          },
          projectedAPY: currentPState.projectedAPY,
          APY: {
            current: currentPState.APY,
            lastEpoch: isZeroEpoch || isNewPool ? null : lastEpochPState.APY,
          },
          underlyingTokenInfo: p.underlyingTokenInfo,
          marketMakerInfo: {
            name: p.marketMakerIdentifier,
            tradedVolume: {
              current: currentPState.marketMakerTradedVolume,
              lastEpoch:
                isZeroEpoch || isNewPool
                  ? null
                  : lastEpochPState.marketMakerTradedVolume,
            },
            tradedVolumeAveragedDaily: {
              current: currentPState.marketMakerTradedVolumeAveragedDaily,
              lastEpoch:
                isZeroEpoch || isNewPool
                  ? null
                  : lastEpochPState.marketMakerTradedVolumeAveragedDaily,
            },
          },
        };
      }),
    };
  }
}
