import BigNumber from 'bignumber.js';
import { assert } from 'ts-essentials';
import {
  fetchTotalRefundedAmountUSDByAddress,
  fetchTotalRefundedPSP,
} from './persistance/db-persistance';
import { ZERO_BN } from './utils';

export const MAX_PSP_GLOBAL_BUDGET = new BigNumber(30_000_000).multipliedBy(
  10 ** 18,
);
export const MAX_USD_ADDRESS_BUDGET = new BigNumber(30_000);

export type GRPSystemState = {
  totalPSPRefunded: BigNumber;
  totalRefundedAmountUSDByAddress: { [address: string]: BigNumber };
};

/* Gas Refund System Guardian is meant to implement proposal limitations; initially local limit of 30k$ per address and global limit of 30M PSP
 * This loads the current state of the system from database and resolve whether any limits are violated
 * some optimistic in memory updates are inferred to avoid querying database too often
 */
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

  totalRefundedAmountUSD(account: string) {
    return this.systemState.totalRefundedAmountUSDByAddress[account] || ZERO_BN;
  }

  isMaxPSPGlobalBudgetSpent() {
    return this.systemState.totalPSPRefunded.isGreaterThanOrEqualTo(
      MAX_PSP_GLOBAL_BUDGET,
    );
  }

  isAccountUSDBudgetSpent(account: string) {
    return this.totalRefundedAmountUSD(account).isGreaterThanOrEqualTo(
      MAX_USD_ADDRESS_BUDGET,
    );
  }

  assertMaxPSPGlobalBudgetNotReached() {
    assert(!this.isMaxPSPGlobalBudgetSpent(), 'Max PSP global budget spent');
  }

  increaseTotalAmountRefundedUSDForAccount(
    account: string,
    usdAmount: BigNumber,
  ) {
    this.systemState.totalRefundedAmountUSDByAddress[account] =
      this.totalRefundedAmountUSD(account).plus(usdAmount);
  }

  increaseTotalPSPRefunded(amount: BigNumber) {
    this.systemState.totalPSPRefunded = (
      this.systemState.totalPSPRefunded || ZERO_BN
    ).plus(amount);
  }
}

export default new GRPSystemGuardian();
