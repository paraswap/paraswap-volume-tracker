import BigNumber from 'bignumber.js';

export type HistoricalPrice = { timestamp: number; rate: number }[];

export type TxFeesByAddress = {
  [address: string]: {
    accGasFeePSP: BigNumber;
    // TODO: add debug data like accumulate gas used, avg gas price, first/last recorded block
    lastBlockNum: number
  };
};

export type Claimable = {
  address: string;
  amount: string;
  lastBlockNum: number
  totalStakeAmountPSP: number
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

export type PSPStakesByAddress = { [address: string]: BigNumber }

export type MerkleTreeDataByChain = {
  [chainId: number]: MerkleTreeData | null;
}

export interface CompositeKey {
  epoch: number
  address: string
  chainId: string
}
export interface IncompleteEpochData {
  accumulatedGasUsedPSP: string
  // todo: more accumulated gas props; accGasUsed, accGasUsedChainCurrency
  lastBlockNum: number
}

export interface CompletedEpochData {
  totalStakeAmountPSP: string
  refundedAmountPSP: string
  merkleProofs: string[]
  merkleRoot: string
}

export type InitialEpochData = CompositeKey & IncompleteEpochData
export type UpdateCompletedEpochData = CompositeKey & CompletedEpochData
export type EpochGasRefundData = CompositeKey & IncompleteEpochData & Partial<CompletedEpochData>
