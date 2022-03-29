import { PendingEpochGasRefundData } from '../../src/lib/gas-refund';

export type HistoricalPrice = { timestamp: number; rate: number }[];

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

export type StakedPSPByAddress = {
  [address: string]: string;
};
