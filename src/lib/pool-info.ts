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
import * as RewardDistributionABI from './abi/reward-distribution.abi.json';
import BigNumber from 'bignumber.js';
import VolumeTracker from './volume-tracker';
import { BlockInfo } from './block-info';
import { EpochInfo } from './epoch-info';
import { ZERO_BN } from './utils/helpers';

export enum PoolType {
  AMMPool = 'AMMPool',
  MarketMakerPool = 'MarketMakerPool',
}

export type UnderlyingTokenInfo = {
  tokens: {
    address: string;
    percent: number;
  }[];
  DEXName: string; // [Balancer, UniswapV2, etc]
};

export type PoolConfig = {
  address: string;
  underlyingTokenAddress: string;
  type: PoolType;
  name: string;
  marketMakerIdentifier: string;
  poolReleaseBlockNumber: number;
  underlyingTokenInfo?: UnderlyingTokenInfo;
  isActive: boolean;
  beneficiary: string;
};

export const PoolConfigsMap: { [network: number]: PoolConfig[] } = {
  [CHAIN_ID_ROPSTEN]: [
    {
      name: 'ParaSwapPool1',
      address: '0x60402d0018bFa960e75d70D7671293BB4fA5bb33',
      underlyingTokenAddress: '0xd3f80dfa27a803e5de3b4a08150692f9462297e4',
      type: PoolType.MarketMakerPool,
      marketMakerIdentifier: 'ParaswapPool',
      poolReleaseBlockNumber: 11253673,
      isActive: true,
      beneficiary: '0x56178a0d5F301bAf6CF3e1Cd53d9863437345Bf9',
    },
    {
      name: 'ParaSwapPool3',
      address: '0xFB00942071623bd0766A01794025d0d7FD3F8F1D',
      underlyingTokenAddress: '0xd3f80dfa27a803e5de3b4a08150692f9462297e4',
      type: PoolType.MarketMakerPool,
      marketMakerIdentifier: 'ParaswapPool3',
      poolReleaseBlockNumber: 11253673,
      isActive: true,
      // beneficiary: '0x3726771431089578E8541c03630EB954250E4cf4'
      // For testing purposes the beneficiary is set to test address
      beneficiary: '0xeb262c0FEca7E98b58DFaCEF6b4EF17966A907d5',
    },
    {
      name: 'ParaSwapPool4',
      address: '0x856e4a97bF555d9e8cb53D3b8341F93884af9aF2',
      underlyingTokenAddress: '0xd3f80dfa27a803e5de3b4a08150692f9462297e4',
      type: PoolType.MarketMakerPool,
      marketMakerIdentifier: 'ParaswapPool4',
      poolReleaseBlockNumber: 11253673,
      isActive: true,
      beneficiary: '0x4f3a120E72C76c22ae802D129F599BFDbc31cb81',
    },
    {
      name: 'ParaSwapPool7',
      address: '0x75635e0b419683896BFE83F4A175B4F7ba70F952',
      underlyingTokenAddress: '0xd3f80dfa27a803e5de3b4a08150692f9462297e4',
      type: PoolType.MarketMakerPool,
      marketMakerIdentifier: 'ParaswapPool7',
      poolReleaseBlockNumber: 11253673,
      isActive: true,
      beneficiary: '0x9E21cAB04Fb4fd1790Bb7ceC2d0582cA1B839e13',
    },
    {
      name: 'ParaSwapPool9',
      address: '0xD04504CD7f47ca9431a7A23b43fCC0e9E647D466',
      underlyingTokenAddress: '0xd3f80dfa27a803e5de3b4a08150692f9462297e4',
      type: PoolType.MarketMakerPool,
      marketMakerIdentifier: 'ParaswapPool9',
      poolReleaseBlockNumber: 11253673,
      isActive: false,
      beneficiary: '0x8Bc3b61825F7aF1F683a205b05139143Bcef4fB7',
    },
    // {
    //   name: 'ParaSwapPool6',
    //   address: '0x6bDA531A9C610caC7a0229372532ED3c13233797',
    //   underlyingTokenAddress: '0xd3f80dfa27a803e5de3b4a08150692f9462297e4',
    //   type: PoolType.MarketMakerPool,
    //   marketMakerIdentifier: 'ParaswapPool6',
    //   poolReleaseBlockNumber: 11253673,
    //   isActive: false,
    //   beneficiary: '0x0000000000000000000000000000000000000000'
    // },
    // {
    //   name: 'ParaSwapPool7',
    //   address: '0x1490832d701AceF24A938984E6a2D78A98de6207',
    //   underlyingTokenAddress: '0xd3f80dfa27a803e5de3b4a08150692f9462297e4',
    //   type: PoolType.MarketMakerPool,
    //   marketMakerIdentifier: 'ParaswapPool7',
    //   poolReleaseBlockNumber: 11253673,
    //   isActive: true,
    //   beneficiary: '0x9E21cAB04Fb4fd1790Bb7ceC2d0582cA1B839e13'
    // },
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
      beneficiary: '0x56178a0d5F301bAf6CF3e1Cd53d9863437345Bf9',
    },
    {
      name: 'ParaSwapPool3',
      address: '0xea02DF45f56A690071022c45c95c46E7F61d3eAb',
      underlyingTokenAddress: '0xcafe001067cdef266afb7eb5a286dcfd277f3de5',
      type: PoolType.MarketMakerPool,
      marketMakerIdentifier: 'ParaswapPool3',
      poolReleaseBlockNumber: 13619806,
      isActive: true,
      beneficiary: '0x3726771431089578E8541c03630EB954250E4cf4',
    },
    {
      name: 'ParaSwapPool4',
      address: '0x6b1D394Ca67fDB9C90BBd26FE692DdA4F4f53ECD',
      underlyingTokenAddress: '0xcafe001067cdef266afb7eb5a286dcfd277f3de5',
      type: PoolType.MarketMakerPool,
      marketMakerIdentifier: 'ParaswapPool4',
      poolReleaseBlockNumber: 13619811,
      isActive: true,
      beneficiary: '0x4f3a120E72C76c22ae802D129F599BFDbc31cb81',
    },
    {
      name: 'ParaSwapPool7',
      address: '0x37b1E4590638A266591a9C11d6f945fe7A1adAA7',
      underlyingTokenAddress: '0xcafe001067cdef266afb7eb5a286dcfd277f3de5',
      type: PoolType.MarketMakerPool,
      marketMakerIdentifier: 'ParaswapPool7',
      poolReleaseBlockNumber: 13619812,
      isActive: true,
      beneficiary: '0x9E21cAB04Fb4fd1790Bb7ceC2d0582cA1B839e13', // NEXT Beneficary: 0x6484D8AD9a26db34083129f38767126F1d35c774
    },
    {
      name: 'ParaSwapPool8',
      address: '0x03c1eaff32c4bd67ee750ab75ce85ba7e5aa65fb',
      underlyingTokenAddress: '0xcafe001067cdef266afb7eb5a286dcfd277f3de5',
      type: PoolType.MarketMakerPool,
      marketMakerIdentifier: 'ParaswapPool8',
      poolReleaseBlockNumber: 13631757,
      isActive: true,
      beneficiary: '0xE88CAE87eb5e60b8C834075c78944EA4B9Fa92b6',
    },
    {
      name: 'ParaSwapPool9',
      address: '0xC3359DbdD579A3538Ea49669002e8E8eeA191433',
      underlyingTokenAddress: '0xcafe001067cdef266afb7eb5a286dcfd277f3de5',
      type: PoolType.MarketMakerPool,
      marketMakerIdentifier: 'ParaswapPool9',
      poolReleaseBlockNumber: 13631761,
      isActive: true,
      beneficiary: '0x8Bc3b61825F7aF1F683a205b05139143Bcef4fB7',
    },
    {
      name: 'ParaSwapPool10',
      address: '0x36d69afE2194F9A1756ba1956CE2e0287A40F671',
      underlyingTokenAddress: '0xcafe001067cdef266afb7eb5a286dcfd277f3de5',
      type: PoolType.MarketMakerPool,
      marketMakerIdentifier: 'ParaswapPool10',
      poolReleaseBlockNumber: 14068196,
      isActive: true,
      beneficiary: '0xBC33a1F908612640F2849b56b67a4De4d179C151',
    },
  ],
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

const BlockUpdateInterval: { [network: number]: number } = {
  [CHAIN_ID_MAINNET]: 3000,
  [CHAIN_ID_ROPSTEN]: 3000,
};

const BlockDelay: { [network: number]: number } = {
  [CHAIN_ID_MAINNET]: 7,
  [CHAIN_ID_ROPSTEN]: 7,
};

const VestingSchedule = [
  { percent: 50, duration: 15768000 },
  { percent: 50, duration: 31536000 },
];

const PSPDecimals = 18;
const DayDuration = 60 * 60 * 24;

const ProjectedVolumes = [1, 2, 3, 4, 5, 6, 7].map(e =>
  new BigNumber(10).pow(e + PSPDecimals),
);
const ProjectedVolumesStr = ProjectedVolumes.map(p => p.toFixed());
const RewardDistributionAddress: { [network: number]: string } = {
  [CHAIN_ID_MAINNET]: '0x8145cDeeD63e2E3c103F885CbB2cD02a00F54873',
  [CHAIN_ID_ROPSTEN]: '0x8F4390cdE2BA908c60cd27bDf6be352361Af4f5a',
};
const RewardVestingAddress: { [network: number]: string } = {
  [CHAIN_ID_MAINNET]: '0x7cADB05Be17234c22FB7cf414BE37078D3C0239e',
  [CHAIN_ID_ROPSTEN]: '0x4daa1bF3fB372B2A0B7e1Da85EAFff1D57629213',
};

export class PoolInfo {
  static instances: { [network: number]: PoolInfo } = {};

  multicallContract: Contract;
  erc20Interface: Interface;
  spspInterface: Interface;
  rewardDistributionInterface: Interface;
  provider: JsonRpcProvider;
  poolStates: { [blockNumber: number]: CompletePoolState };
  poolSPSPSupply: { [blockNumber: number]: { [poolAddress: string]: bigint } };
  volumeTracker: VolumeTracker;
  private latestBlockNumber: number;
  private latestBlockTimestamp: number;
  private blockInfo: BlockInfo;
  private epochInfo: EpochInfo;

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
    this.rewardDistributionInterface = new Interface(RewardDistributionABI);
    this.poolStates = {};
    this.poolSPSPSupply = {};
    this.blockInfo = BlockInfo.getInstance(this.network);
    this.epochInfo = EpochInfo.getInstance(this.network);
    this.volumeTracker = VolumeTracker.getInstance(this.network);
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
    this.latestBlockNumber = latestBlock.number - BlockDelay[this.network];
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
      BlockUpdateInterval[this.network],
    );
    await this.setLatestBlockNumber();
  }

  // This is not fully correct as the deposits done on the same block after the reward tx is
  // also considered. epochEndBlock is used instead of epochEndBlock - 1 as with epochEndBlock
  // the earnedPSP is a lower bound while on the other case its an upper bound.
  // TODO: memorize this on db to avoid archive calls
  async fetchEarnedPSPEpoch(
    userAddress: string,
    epoch: number,
  ): Promise<{ [poolAddress: string]: bigint }> {
    const epochEndBlockNumber = this.epochInfo.getEpochEndBlock(epoch);

    const pools = this.poolConfigs.filter(
      p => p.poolReleaseBlockNumber <= epochEndBlockNumber,
    );

    if (!this.poolSPSPSupply[epochEndBlockNumber]) {
      const multiCallData = pools.map(p => {
        return {
          target: p.address,
          callData: this.spspInterface.encodeFunctionData('totalSupply'),
        };
      });
      const rawResult = await this.multicallContract.functions.aggregate(
        multiCallData,
        { blockTag: epochEndBlockNumber },
      );
      const SPSPSupply: { [address: string]: bigint } = {};
      pools.forEach(
        (p, i) =>
          (SPSPSupply[p.address.toLowerCase()] = BigInt(
            this.spspInterface
              .decodeFunctionResult('totalSupply', rawResult.returnData[i])
              .toString(),
          )),
      );
      this.poolSPSPSupply[epochEndBlockNumber] = SPSPSupply;
    }
    const SPSPSupply = this.poolSPSPSupply[epochEndBlockNumber];

    const multiCallData = pools.map(p => {
      return {
        target: p.address,
        callData: this.erc20Interface.encodeFunctionData('balanceOf', [
          userAddress,
        ]),
      };
    });

    const rawResult = await this.multicallContract.functions.aggregate(
      multiCallData,
      { blockTag: epochEndBlockNumber },
    );
    const SPSPBalances = pools.map((p, i) =>
      BigInt(
        this.erc20Interface
          .decodeFunctionResult('balanceOf', rawResult.returnData[i])
          .toString(),
      ),
    );

    const poolRewards = this.epochInfo.getPoolRewards(epoch);
    const PSPEarned = pools.reduce(
      (acc: { [address: string]: bigint }, p, i) => {
        const pAddr = p.address.toLowerCase();
        if (pAddr in poolRewards)
          acc[p.address.toLowerCase()] =
            (SPSPBalances[i] * BigInt(poolRewards[pAddr])) /
            SPSPSupply[p.address.toLowerCase()];
        return acc;
      },
      {},
    );

    return PSPEarned;
  }

  public async fetchEarnedPSP(
    userAddress: string,
  ): Promise<{ [poolAddress: string]: string }> {
    const currentEpoch = this.epochInfo.getCurrentEpoch();
    const epochEarnings = await Promise.all(
      Array.from(Array(currentEpoch).keys()).map(i =>
        this.fetchEarnedPSPEpoch(userAddress, i),
      ),
    );
    const totalEarnings = epochEarnings.reduce(
      (acc: { [poolAddress: string]: bigint }, e) => {
        Object.entries(e).forEach(([key, value]) => {
          if (!(key in acc)) acc[key] = BigInt(0);
          acc[key] += value;
        });
        return acc;
      },
      {},
    );
    const totalEarningsS: { [poolAddress: string]: string } = {};
    Object.entries(totalEarnings).forEach(
      ([key, value]) => (totalEarningsS[key] = value.toString()),
    );
    return totalEarningsS;
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

    const isCurrentEpoch = epoch === this.epochInfo.getCurrentEpoch();

    const blockNumber = isCurrentEpoch
      ? this.latestBlockNumber
      : this.epochInfo.getEpochEndBlock(epoch);

    if (blockNumber in this.poolStates) return this.poolStates[blockNumber];

    const epochStartCalcTime = await this.epochInfo.getEpochStartCalcTime(
      epoch,
    );

    const epochEndCalcTime = isCurrentEpoch
      ? undefined
      : this.epochInfo.getEpochEndCalcTime(epoch);

    const epochReward = this.epochInfo.getPSPPoolReward(epoch);

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
      this.epochInfo.getEpochDuration() / (60 * 60 * 24);
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
          epochStartCalcTime + this.epochInfo.getEpochDuration(),
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

  private calculatePoolRewardStableAPY(
    marketMakerVolumes: string[],
    poolStakedUnderlyingTokens: string[],
    epochReward: string,
  ): BigNumber[] {
    const EpochDurationDays =
      this.epochInfo.getEpochDuration() / (60 * 60 * 24);
    const factor = new BigNumber(100).times(365 / EpochDurationDays);
    const apy = 15; // average APY

    const rewards = poolStakedUnderlyingTokens.map(stake =>
      new BigNumber(stake).multipliedBy(apy).div(factor),
    );

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
    const baseSumWeight = baseWeights.reduce(
      (sum, w) => sum.plus(w),
      new BigNumber(0),
    );
    const projectedRewards = poolStakedUnderlyingTokens.map((s, i) =>
      ProjectedVolumes.map(v => {
        const currentWeight = new BigNumber(marketMakerVolumes[i])
          .times(v.plus(s))
          .squareRoot();
        return currentWeight
          .times(epochReward)
          .div(baseSumWeight.minus(baseWeights[i]).plus(currentWeight));
      }),
    );
    return projectedRewards;
  }

  private calculatePoolAPYs(
    marketMakerVolumes: string[],
    onChainPoolStates: OnChainPoolState[],
    epochReward: string,
  ): {
    poolAPYs: BigNumber[];
    projectedPoolAPYs: BigNumber[][];
  } {
    const poolStakedUnderlyingTokens = onChainPoolStates.map(s =>
      (s.underlyingTokenBalance - s.underlyingTokenLocked).toString(),
    );
    const rewards = this.calculatePoolRewardStableAPY(
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
      this.epochInfo.getEpochDuration() / (60 * 60 * 24);
    const factor = new BigNumber(100).times(365 / EpochDurationDays);
    const poolAPYs = rewards.map((r, i) =>
      poolStakedUnderlyingTokens[i] == '0'
        ? new BigNumber(0)
        : r.times(factor).div(poolStakedUnderlyingTokens[i]),
    );

    const BN0 = new BigNumber(0);

    const projectedPoolAPYs = projectedRewards.map((poolRewards, i) =>
      poolRewards.map((r, j) =>
        poolStakedUnderlyingTokens[i] == '0' && ProjectedVolumes[j].eq(BN0)
          ? new BigNumber(0)
          : r
              .times(factor)
              .div(ProjectedVolumes[j].plus(poolStakedUnderlyingTokens[i])),
      ),
    );
    return { poolAPYs, projectedPoolAPYs };
  }

  private async getPSPPrice(blockNumber: number): Promise<number | null> {
    // TODO: replace null wth some pricing source
    return null;
  }

  async getCurrentEpochRewardParams(calcTimeStamp: number): Promise<{
    poolAddresses: string[];
    poolAmounts: string[];
    vestingBeneficiaries: string[];
    vestingAmounts: string[];
    vestingDurations: number[];
    vesting: string;
    calcTimeStamp: number;
    epochPoolReward: string;
    epochMarketMakerReward: string;
    volumes: string[];
    stakes: string[];
    blockNumber: number;
    rewardDistributionAddress: string;
    calldata: string;
  }> {
    const epochReward = this.epochInfo.getCurrentPSPPoolReward();
    const currentEpoch = this.epochInfo.getCurrentEpoch();
    const epochCalcStartTime = await this.epochInfo.getEpochStartCalcTime(
      currentEpoch,
    );

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

    const amounts = this.calculatePoolRewardStableAPY(
      marketMakerVolumes,
      stakes,
      epochReward,
    ).map(a => a.toFixed(0, BigNumber.ROUND_FLOOR));

    const _epochReward = amounts
      .reduce((acc, curr) => acc.plus(curr), ZERO_BN)
      .toString();

    const addresses = this.poolConfigs.map(p => p.address);

    let vestingBeneficiaries: string[] = [];
    let vestingAmounts: string[] = [];
    let vestingDurations: number[] = [];

    ////// COMMENTED APY SMOOTHING
    // this.poolConfigs.forEach((p, i) =>
    //   VestingSchedule.forEach(v => {
    //     vestingBeneficiaries.push(p.beneficiary);
    //     vestingAmounts.push(
    //       ((BigInt(amounts[i]) * BigInt(v.percent)) / BigInt(100)).toString(),
    //     );
    //     vestingDurations.push(v.duration);
    //   }),
    // );

    const calldata = this.rewardDistributionInterface.encodeFunctionData(
      'multiSendReward',
      [
        addresses,
        amounts,
        vestingBeneficiaries,
        vestingAmounts,
        vestingDurations,
        RewardVestingAddress[this.network],
        calcTimeStamp,
      ],
    );

    return {
      poolAddresses: addresses,
      poolAmounts: amounts,
      volumes: marketMakerVolumes,
      stakes,
      calcTimeStamp,
      epochPoolReward: _epochReward,
      epochMarketMakerReward: '0',
      blockNumber: epochEndBlockNumber,
      vestingBeneficiaries,
      vesting: RewardVestingAddress[this.network],
      vestingAmounts,
      vestingDurations,
      rewardDistributionAddress: RewardDistributionAddress[this.network],
      calldata,
    };
  }

  async getLatestPoolData(): Promise<StakingPoolInfo> {
    const currentEpoch = this.epochInfo.getCurrentEpoch();
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
