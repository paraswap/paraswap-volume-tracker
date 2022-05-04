import BigNumber from 'bignumber.js';
import {
  CHAIN_ID_BINANCE,
  CHAIN_ID_FANTOM,
  CHAIN_ID_MAINNET,
  CHAIN_ID_POLYGON,
} from './constants';

export const GRP_SUPPORTED_CHAINS = [
  CHAIN_ID_MAINNET,
  CHAIN_ID_POLYGON,
  CHAIN_ID_BINANCE,
  CHAIN_ID_FANTOM,
];

export const GasRefundGenesisEpoch = 9;
export const GasRefundPricingAlgoFlipEpoch = 11;
export const GasRefundSafetyModuleStartEpoch = 11;
export const GasRefundDeduplicationStartEpoch = 12;
export const GasRefundTxOriginCheckStartEpoch = 12;
export const GasRefundSPSPStakesAlgoFlipEpoch = 12;
// todo: set this number accordingly
export const GasRefundSwapSourceCovalentStartEpoch = 13;


// todo: missing 2,5,6 - check that's expected
export const STAKING_POOL_ADDRESSES: Record<string, string> = {
  POOL_1: '0x55A68016910A7Bcb0ed63775437e04d2bB70D570',
  POOL_3: '0xea02DF45f56A690071022c45c95c46E7F61d3eAb',
  POOL_4: '0x6b1D394Ca67fDB9C90BBd26FE692DdA4F4f53ECD',
  POOL_7: '0x37b1E4590638A266591a9C11d6f945fe7A1adAA7',
  POOL_8: '0x03c1eaff32c4bd67ee750ab75ce85ba7e5aa65fb',
  POOL_9: '0xC3359DbdD579A3538Ea49669002e8E8eeA191433',
  POOL_10: '0x36d69afE2194F9A1756ba1956CE2e0287A40F671',
}

export const AUGUSTUS_ADDRESS = '0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57'

interface BaseGasRefundData {
  epoch: number;
  address: string;
  chainId: number;
}
export interface PendingEpochGasRefundData extends BaseGasRefundData {
  accumulatedGasUsed: string;
  accumulatedGasUsedPSP: string;
  accumulatedGasUsedChainCurrency: string;
  accumulatedGasUsedUSD: string;
  firstBlock: number;
  lastBlock: number;
  firstTimestamp: number;
  lastTimestamp: number;
  isCompleted: false;
  totalStakeAmountPSP: string;
  refundedAmountPSP: string;
  refundedAmountUSD: string;
  firstTx: string;
  lastTx: string;
  numTx: number;
}

export interface CompletedEpochGasRefundData
  extends Partial<Omit<PendingEpochGasRefundData, 'isCompleted'>> {
  merkleProofs: string[];
  isCompleted: true;
}

export type EpochGasRefundData = Partial<
  Omit<CompletedEpochGasRefundData, 'isCompleted'>
> & { isCompleted: boolean };

export type GasRefundDistributionData = {
  epoch: number;
  chainId: number;
  totalPSPAmountToRefund: string;
  merkleRoot: string;
};

type GasRefundLevel = 'level_1' | 'level_2' | 'level_3' | 'level_4';

type GasRefundLevelsDef = {
  level: GasRefundLevel;
  minStakedAmount: BigNumber;
  refundPercent: number;
};

export interface GasRefundParticipantData {
  epoch: number;
  address: string
  chainId: number;
  merkleProofs: string[];
  isCompleted: boolean;
}
export interface GasRefundTransactionData {
  epoch: number;
  address: string;
  chainId: number;
  hash: string;
  occurence: number;
  block: number;
  timestamp: number;
  gasUsed: string;
  gasUsedChainCurrency: string;
  gasUsedUSD: string;
  pspUsd: number;
  chainCurrencyUsd: number;
  pspChainCurrency: number;
  totalStakeAmountPSP: string;
  refundedAmountPSP: string;
  refundedAmountUSD: string;
}

//                                                  psp decimals
const scale = (num: number) => new BigNumber(num).multipliedBy(1e18);

export const GRP_MIN_STAKE = scale(500);

const gasRefundLevels: GasRefundLevelsDef[] = [
  {
    level: 'level_1' as const,
    minStakedAmount: GRP_MIN_STAKE,
    refundPercent: 0.25,
  },
  {
    level: 'level_2' as const,
    minStakedAmount: scale(5_000),
    refundPercent: 0.5,
  },
  {
    level: 'level_3' as const,
    minStakedAmount: scale(50_000),
    refundPercent: 0.75,
  },
  {
    level: 'level_4' as const,
    minStakedAmount: scale(500_000),
    refundPercent: 1,
  },
].reverse(); // reverse for descending lookup

export const getRefundPercent = (stakedAmount: string): number | undefined =>
  gasRefundLevels.find(({ minStakedAmount }) =>
    new BigNumber(stakedAmount).gte(minStakedAmount),
  )?.refundPercent;

