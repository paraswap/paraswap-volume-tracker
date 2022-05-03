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

// todo: remove/refactor with above/previous structures as some will be obsolete
export interface GasRefundParticipantData {
  epoch: number;
  address: string
  chainId: number;
  merkleProofs: string[];
  isCompleted: boolean;
  refundedAmountPSP: string;
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
  gasUsedPSP: string;
  gasUsedUSD: string;
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
