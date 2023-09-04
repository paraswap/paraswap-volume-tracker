import BigNumber from 'bignumber.js';
import {
  CHAIN_ID_BINANCE,
  CHAIN_ID_FANTOM,
  CHAIN_ID_GOERLI,
  CHAIN_ID_MAINNET,
  CHAIN_ID_OPTIMISM,
  CHAIN_ID_POLYGON,
} from '../constants';
import { isTruthy } from '../utils';
import {ChainBalanceMapping} from "../../types";
import {AddressRewardsMapping} from "../../../scripts/gas-refund-program/types";

export const isMainnetStaking = true; // TODO FIXME move to env var

export const GRP_SUPPORTED_CHAINS = [
  isMainnetStaking ? undefined : CHAIN_ID_GOERLI,
  CHAIN_ID_MAINNET,
  CHAIN_ID_OPTIMISM,
  CHAIN_ID_POLYGON,
  CHAIN_ID_BINANCE,
  CHAIN_ID_FANTOM,
].filter(isTruthy);

export const GRP_V2_SUPPORTED_CHAINS_STAKING = new Set([
  CHAIN_ID_OPTIMISM,
  isMainnetStaking ? CHAIN_ID_MAINNET : CHAIN_ID_GOERLI,
]);

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
export const GasRefundV2EpochFlip = 31;
export const GasRefundV2EpochPSPEP3Flip = 32;
export const GasRefundV2EpochOptimismFlip = 34;

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
  GRPChainBreakDown: { [grpChainId: number]: BigNumber }
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
  paraBoostFactor: number;
}

//                                                  psp decimals
const scale = (num: number) => new BigNumber(num).multipliedBy(1e18);

const GRP_MIN_STAKE_V1_BN = scale(500);
export const getMinStake = (epoch: number) =>
  epoch < GasRefundV2EpochFlip ? GRP_MIN_STAKE_V1_BN : 1; // set min of 1wei to avoid overfetching

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

// as voted in https://vote.paraswap.network/#/proposal/0xa288047720c94db99b0405b665d3724dc0329d11968420ba1357ccbb2225ab39
const GRP_MIN_REFUND_ALLOWED = 0.25;
export const GRP_MAX_REFUND_PERCENT = 0.95;

export const grpV2Func = (x: number): number => {
  const rawRefundPecent = 0.152003 * Math.log(0.000517947 * x);

  const cappedRefundPercent =
    rawRefundPecent < GRP_MIN_REFUND_ALLOWED
      ? 0
      : Math.min(rawRefundPecent, GRP_MAX_REFUND_PERCENT);

  return cappedRefundPercent;
};

export const getRefundPercentV2 = (score: string): number => {
  const scoreNorm = +(BigInt(score) / BigInt(10 ** 18)).toString();
  const refundPercent = grpV2Func(scoreNorm);
  return refundPercent;
};

export const getRefundPercent = (
  epoch: number,
  stakedAmount: string,
): number | undefined =>
  (epoch < GasRefundV2EpochFlip ? getRefundPercentV1 : getRefundPercentV2)(
    stakedAmount,
  );
