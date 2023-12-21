import type { BigNumber } from 'bignumber.js';

export interface ChainBalanceMapping {
  [chainId: number]: string;
}

export type AmountsByProgram = Record<string, string>;

export type AddressRewards = {
  account: string;
  amount: BigNumber;
  chainId: number;
  breakDownGRP: { [GRPChainId: number]: BigNumber };
};

export type AddressRewardsWithAmountsByProgram = AddressRewards & {
  amountsByProgram: AmountsByProgram;
};
