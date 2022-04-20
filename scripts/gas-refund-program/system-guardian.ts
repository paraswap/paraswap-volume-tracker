import BigNumber from 'bignumber.js';
import { assert } from 'ts-essentials';
import {
  fetchTotalRefundedAmountUSDByAddress,
  fetchTotalRefundedPSP,
} from './persistance/db-persistance';

export const MAX_PSP_GLOBAL_BUDGET = new BigNumber(30_000_000).multipliedBy(
  10 ** 18,
);
export const MAX_USD_ADDRESS_BUDGET = new BigNumber(30_000);

export type GRPSystemState = {
  totalPSPRefunded: BigNumber;
  totalRefundedAmountUSDByAddress: { [address: string]: BigNumber };
};

class GRPSystemGuardian {
  systemState: GRPSystemState;

  async loadStateFromDB() {
    const [totalPSPRefunded, totalRefundedAmountUSDByAddress] =
      await Promise.all([
        fetchTotalRefundedPSP(),
        fetchTotalRefundedAmountUSDByAddress(),
      ]);

    this.systemState = {
      totalPSPRefunded,
      totalRefundedAmountUSDByAddress,
    };
  }

  isMaxPSPGlobalBudgetSpent() {
    return this.systemState.totalPSPRefunded.isGreaterThan(
      MAX_PSP_GLOBAL_BUDGET,
    );
  }

  isAccountUSDBudgetSpent(account: string) {
    return this.systemState.totalRefundedAmountUSDByAddress[
      account
    ].isGreaterThan(MAX_USD_ADDRESS_BUDGET);
  }

  assertMaxPSPGlobalBudgetNotReached() {
    assert(!this.isMaxPSPGlobalBudgetSpent(), 'Max PSP global budget spent');
  }

  increaseTotalAmountRefundedUSDForAccount(
    account: string,
    usdAmount: BigNumber,
  ) {
    this.systemState.totalRefundedAmountUSDByAddress[account] = (
      this.systemState.totalRefundedAmountUSDByAddress[account] ||
      new BigNumber(0)
    ).plus(usdAmount);
  }

  increaseTotalPSPRefunded(amount: BigNumber) {
    this.systemState.totalPSPRefunded = (
      this.systemState.totalPSPRefunded || new BigNumber(0)
    ).plus(amount);
  }
}

export default new GRPSystemGuardian();
