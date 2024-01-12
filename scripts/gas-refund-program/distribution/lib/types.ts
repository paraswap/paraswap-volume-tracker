import type BigNumber from 'bignumber.js';
import { AmountsByProgram } from '../../../../src/types';

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
  proof: string[];
  address: string;
  amount: string;
  epoch: number;
  GRPChainBreakDown: { [chainId: number]: string };
  amountsByProgram: Record<string, string>;
};

export type GasRefundMerkleTree = {
  root: MerkleRoot;
  merkleProofs: GasRefundMerkleProof[];
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
    amountsByProgram: AmountsByProgram;
    byChain: { [grpChainId: number]: BigNumber };
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
