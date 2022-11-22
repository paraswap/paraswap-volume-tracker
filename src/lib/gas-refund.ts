import BigNumber from 'bignumber.js';
import {
  CHAIN_ID_BINANCE,
  CHAIN_ID_FANTOM,
  CHAIN_ID_GOERLI,
  CHAIN_ID_MAINNET,
  CHAIN_ID_POLYGON,
} from './constants';

export const GRP_SUPPORTED_CHAINS = [
  CHAIN_ID_MAINNET,
  CHAIN_ID_POLYGON,
  CHAIN_ID_BINANCE,
  CHAIN_ID_FANTOM,
];

export const GRP_V2_SUPPORTED_CHAINS_STAKING = [
  CHAIN_ID_MAINNET,
  CHAIN_ID_GOERLI,
];

const WEEKS_IN_YEAR = 52;
const EPOCH_LENGTH_IN_WEEK = 2;
export const TOTAL_EPOCHS_IN_YEAR = WEEKS_IN_YEAR / EPOCH_LENGTH_IN_WEEK;

export const VIRTUAL_LOCKUP_PERIOD = 7 * 24 * 60 * 60;

export const GasRefundGenesisEpoch = 9;
export const GasRefundPricingAlgoFlipEpoch = 11;
export const GasRefundSafetyModuleStartEpoch = 11;
export const GasRefundDeduplicationStartEpoch = 12;
export const GasRefundTxOriginCheckStartEpoch = 12;
export const GasRefundSPSPStakesAlgoFlipEpoch = 12;
export const GasRefundConsiderContractTXsStartEpoch = 12;
export const GasRefundPrecisionGlitchRefundedAmountsEpoch = 12;
export const GasRefundBudgetLimitEpochBasedStartEpoch = 16;
export const GasRefundVirtualLockupStartEpoch = 17;
export const GasRefundSafetyModuleAllPSPInBptFixStartEpoch = 20;
export const GasRefundV2EpochFlip = 26; // FIXME

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
  address: string;
  chainId: number;
  merkleProofs: string[];
  isCompleted: boolean;
}

export enum TransactionStatus {
  IDLE = 'idle',
  VALIDATED = 'validated',
  REJECTED = 'rejected',
}
export interface GasRefundTransactionData {
  epoch: number;
  address: string;
  chainId: number;
  hash: string;
  block: number;
  timestamp: number;
  gasUsed: string;
  gasUsedChainCurrency: string;
  gasPrice: string;
  gasUsedUSD: string;
  pspUsd: number;
  chainCurrencyUsd: number;
  pspChainCurrency: number;
  totalStakeAmountPSP: string;
  refundedAmountPSP: string;
  refundedAmountUSD: string;
  contract: string;
  status: TransactionStatus;
}

//                                                  psp decimals
const scale = (num: number) => new BigNumber(num).multipliedBy(1e18);

const GRP_MIN_STAKE_V1_BN = scale(500);
const GRP_MIN_STAKE_V2_NORM = 10_000;
const GRP_MIN_STAKE_V2_BN = scale(GRP_MIN_STAKE_V2_NORM);
export const getMinStake = (epoch: number) =>
  epoch < GasRefundV2EpochFlip ? GRP_MIN_STAKE_V1_BN : GRP_MIN_STAKE_V2_BN;

const gasRefundLevelsV1: GasRefundLevelsDef[] = [
  {
    level: 'level_1' as const,
    minStakedAmount: GRP_MIN_STAKE_V1_BN,
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

export const getRefundPercentV1 = (stakedAmount: string): number | undefined =>
  gasRefundLevelsV1.find(({ minStakedAmount }) =>
    new BigNumber(stakedAmount).gte(minStakedAmount),
  )?.refundPercent;

/*
 * curve plot: https://www.wolframalpha.com/input?key=&i2d=true&i=plot+abs\(40)0.126506+*+ln\(40)0.335487+*+x+++1.64295\(41)+-+0.789135\(41)\(44)+10000+<+x+<+1000000
 * see proposal: https://gov.paraswap.network/t/psp-2-0-revised-voting-edition/1207
 */
const grpV2Func = (x: number) => {
  if (x < GRP_MIN_STAKE_V2_NORM) return 0;

  return Math.min(
    Math.abs(0.126506 * Math.log(0.335487 * x + 1.64295) - 0.789135),
    0.95,
  );
};

export const getRefundPercentV2 = (scoreNorm: string): number => {
  const bScoreNorm = BigInt(scoreNorm);
  const scoreDnorm = +(bScoreNorm / BigInt(10 ** 18)).toString();
  const refundPercent = grpV2Func(scoreDnorm);
  return refundPercent;
};

export const getRefundPercent = (
  epoch: number,
  stakedAmount: string,
): number | undefined =>
  (epoch < GasRefundV2EpochFlip ? getRefundPercentV1 : getRefundPercentV2)(
    stakedAmount,
  );
