import BigNumber from 'bignumber.js';

export type HistoricalPrice = { timestamp: number; rate: number }[];

export type TxFeesByAddress = {
  [address: string]: {
    accGasFeePSP: BigNumber;
    // TODO: add debug data like accumulate gas used, avg gas price, first/last recorded block
  };
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
