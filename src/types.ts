import type { BigNumber } from 'bignumber.js';

export interface ChainBalanceMapping {
  [chainId: number]: string;
}

export type AmountsByProgram = Record<string, string>;

export type ProgramAgnosticAddressRewards = {
  account: string;
  amount: BigNumber;
  chainId: number;
};

type AddressRewardsGRP = ProgramAgnosticAddressRewards & {
  breakDownGRP: { [GRPChainId: number]: BigNumber };
};

type AmountsByProgramField = {
  amountsByProgram: AmountsByProgram;
};

type ItemGRP = AddressRewardsGRP & AmountsByProgramField;
type ItemAura = ProgramAgnosticAddressRewards & AmountsByProgramField;
export type AddressRewardsWithAmountsByProgramVariation = ItemGRP | ItemAura;

type ProgramAgnosticAddressRewardsWithAmountsByProgramWithTemporaryGRP =
  AddressRewardsGRP & {
    amountsByProgram: AmountsByProgram;
  };
