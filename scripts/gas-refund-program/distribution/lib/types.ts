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

export type RewardMerkleProof = {
  proof: string[];
  address: string;
  amount: string;
  epoch: number;
  GRPChainBreakDown: { [chainId: number]: string } | null; // will be null if address is not eligible for GRP (could be if they are still eligible for Aura for example)
  amountsByProgram: AmountsByProgram;
  debugInfo?: any;
};

export type RewardMerkleTree = {
  root: MerkleRoot;
  merkleProofs: RewardMerkleProof[];
};

export type MerkleTreeAndChain = {
  merkleTree: RewardMerkleTree;
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

export type AddressRewardsMappingWithMaybeGRP = {
  [account: string]: {
    amountsByProgram: AmountsByProgram;
    byChain: { [grpChainId: number]: BigNumber } | null; // only exist in GRP-inclusive items
    debugInfo?: any;
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
