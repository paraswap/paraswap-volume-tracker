import type BigNumber from 'bignumber.js';

export type Claimable = {
  address: string;
  amount: string;
};

export type MerkleRoot = {
  merkleRoot: string;
  totalAmount: string;
  epoch: number;
};

export type GasRefundMerkleProof = {
  merkleProofs: string[];
  address: string;
  amount: string;
  epoch: number;
  GRPChainBreakDown?: { [chainId: number]: string };
};

export type GasRefundMerkleTree = {
  root: MerkleRoot;
  leaves: GasRefundMerkleProof[];
};

export type MerkleTreeAndChain = {
  merkleTree: GasRefundMerkleTree;
  chainId: string;
};

export type AddressChainRewardsMapping = {
  [account: string]: ChainRewardsMapping;
};

export type ChainRewardsMapping = {
  [chainId: number]: {
    amount: BigNumber;
    breakDownGRP: { [GRPChainId: number]: BigNumber };
  };
};

export type AddressRewards = {
  account: string;
  amount: BigNumber;
  chainId: number;
  breakDownGRP: { [GRPChainId: number]: BigNumber };
};

export type AddressRewardsMapping = {
  [account: string]: {
    [grpChainId: number]: BigNumber;
  };
};

export type ParticipationData = {
  address: string;
  amount: string;
  epoch: number;
  GRPChainBreakDown: {
    [chainId: number]: string;
  };
};

export type ParticipationDataWithProof = ParticipationData & {
  proof: string[];
};
