import BigNumber from 'bignumber.js';

export type HistoricalPrice = { timestamp: number; rate: number }[];

export interface BaseGasRefundData {
  epoch: number;
  address: string;
  chainId: number;
}
export interface PendingEpochGasRefundData extends BaseGasRefundData {
  accumulatedGasUsedPSP: string;
  accumulatedGasUsed: string;
  lastBlockNum: number;
  isCompleted: false;
  totalStakeAmountPSP: string;
}

export interface CompletedEpochGasRefundData
  extends Partial<Omit<PendingEpochGasRefundData, 'isCompleted'>> {
  refundedAmountPSP: string;
  merkleProofs: string[];
  isCompleted: true;
}

export type EpochGasRefundData =
  | PendingEpochGasRefundData
  | CompletedEpochGasRefundData;

export type GasRefundProgramdata = {
  epoch: number;
  chainId: number;
  totalPSPAmountToRefund: string;
  merkleRoot: string;
};

export type TxFeesByAddress = {
  [address: string]: PendingEpochGasRefundData;
};

export type Claimable = {
  address: string;
  amount: string;
  lastBlockNum: number;
  totalStakeAmountPSP: string;
};

export type MerkleRoot = {
  merkleRoot: string;
  totalAmount: string;
  epoch: number;
};

export type MerkleData = {
  merkleProofs: string[];
  address: string;
  amount: string;
  epoch: number;
};

export type MerkleTreeData = {
  root: MerkleRoot;
  leaves: MerkleData[];
};

export type MerkleTreeDataByChain = {
  [chainId: number]: MerkleTreeData | null;
};

export type StakedPSPByAddress = {
  [address: string]: string;
};
