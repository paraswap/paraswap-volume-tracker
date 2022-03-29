export type HistoricalPrice = { timestamp: number; rate: number }[];

interface BaseGasRefundData {
  epoch: number;
  address: string;
  chainId: number;
}
export interface PendingEpochGasRefundData extends BaseGasRefundData {
  accumulatedGasUsedPSP: string;
  accumulatedGasUsed: string;
  accumulatedGasUsedChainCurrency: string;
  lastBlockNum: number;
  isCompleted: false;
  totalStakeAmountPSP: string;
  refundedAmountPSP: string;
  updated?: boolean;
}

export interface CompletedEpochGasRefundData
  extends Partial<Omit<PendingEpochGasRefundData, 'isCompleted'>> {
  merkleProofs: string[];
  isCompleted: true;
}

export type EpochGasRefundData = Partial<Omit<CompletedEpochGasRefundData, 'isCompleted'>> & {isCompleted: boolean}

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
