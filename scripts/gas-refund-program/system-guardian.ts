import BigNumber from 'bignumber.js';
import { assert } from 'ts-essentials';

export const MAX_PSP_GLOBAL_BUDGET = new BigNumber(30_000_000).multipliedBy(
  10 ** 18,
);
export const MAX_USD_ADDRESS_BUDGET = new BigNumber(30_000);

export type GRPSystemState = {
  totalPSPRefunded: BigNumber;
  totalRefundedAmountUSDByAddress: { [address: string]: BigNumber };
};

export type GRPSystemStateGuard = {
  systemState: GRPSystemState;
  isMaxPSPGlobalBudgetSpent: () => boolean;
  isAccountUSDBudgetSpent: (account: string) => boolean;
  assertMaxPSPGlobalBudgetNotReached: () => void;
  increaseTotalAmountRefundedUSDForAccount: (
    account: string,
    amount: BigNumber,
  ) => void;
  increaseTotalPSPRefunded: (amount: BigNumber) => void;
};

export const constructGRPSystemGuardian = (
  systemState: GRPSystemState,
): GRPSystemStateGuard => {
  const isMaxPSPGlobalBudgetSpent = (): boolean =>
    systemState.totalPSPRefunded.isGreaterThan(MAX_PSP_GLOBAL_BUDGET);

  const isAccountUSDBudgetSpent = (account: string): boolean =>
    systemState.totalRefundedAmountUSDByAddress[account].isGreaterThan(
      MAX_USD_ADDRESS_BUDGET,
    );

  return {
    systemState,

    isMaxPSPGlobalBudgetSpent,

    isAccountUSDBudgetSpent,

    assertMaxPSPGlobalBudgetNotReached: () =>
      assert(!isMaxPSPGlobalBudgetSpent(), 'Max PSP global budget spent'),

    increaseTotalAmountRefundedUSDForAccount: (
      account: string,
      usdAmount: BigNumber,
    ) => {
      systemState.totalRefundedAmountUSDByAddress[account] = (
        systemState.totalRefundedAmountUSDByAddress[account] || new BigNumber(0)
      ).plus(usdAmount);
    },

    increaseTotalPSPRefunded: (amount: BigNumber) => {
      systemState.totalPSPRefunded = (
        systemState.totalPSPRefunded || new BigNumber(0)
      ).plus(amount);
    },
  };
};
