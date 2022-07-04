import BigNumber from 'bignumber.js';
import { assert } from 'ts-essentials';
import {
  fetchTotalRefundedAmountUSDByAddress,
  fetchTotalRefundedPSP,
} from '../persistance/db-persistance';
import { ZERO_BN } from '../../../src/lib/utils/helpers';
import { GasRefundGenesisEpoch } from '../../../src/lib/gas-refund';

export const MAX_PSP_GLOBAL_BUDGET_YEARLY = new BigNumber(
  30_000_000,
).multipliedBy(10 ** 18);
export const MAX_USD_ADDRESS_BUDGET_YEARLY = new BigNumber(30_000);
export const MAX_USD_ADDRESS_BUDGET_EPOCH =
  MAX_USD_ADDRESS_BUDGET_YEARLY.dividedBy(12 * 2); // epoch based: 1 epoch = 2 weeks

export type GRPSystemState = {
  totalPSPRefundedForYear: BigNumber;
  totalRefundedAmountUSDByAddressForYear: { [address: string]: BigNumber };
  budgetStatePerEpoch: {
    epoch: number;
    totalRefundedAmountUSDByAddressForEpoch: { [address: string]: BigNumber };
  };
};

/* Gas Refund System Guardian is meant to implement proposal limitations; initially local limit of 30k$ per address and global limit of 30M PSP
 * This loads the current state of the system from database and resolve whether any limits are violated
 * some optimistic in memory updates are inferred to avoid querying database too often
 */

// @FIXME: yearly conditions are not taking into account year rotations. Either consider moving (last 365) or hard year date.
export class GRPBudgetGuardian {
  state: GRPSystemState;

  static instance: GRPBudgetGuardian;

  static getInstance() {
    if (!this.instance) {
      this.instance = new GRPBudgetGuardian();
    }

    return this.instance;
  }

  async loadStateFromDB(toEpoch?: number) {
    const [totalPSPRefunded, totalRefundedAmountUSDByAddress] =
      await Promise.all([
        fetchTotalRefundedPSP(toEpoch),
        fetchTotalRefundedAmountUSDByAddress(toEpoch),
      ]);

    this.state = {
      totalPSPRefundedForYear: totalPSPRefunded,
      totalRefundedAmountUSDByAddressForYear: totalRefundedAmountUSDByAddress,
      budgetStatePerEpoch: {
        epoch: GasRefundGenesisEpoch,
        totalRefundedAmountUSDByAddressForEpoch: {},
      },
    };
  }

  cleanBudgetStateForEpoch() {
    this.state.budgetStatePerEpoch = {
      epoch: GasRefundGenesisEpoch,
      totalRefundedAmountUSDByAddressForEpoch: {},
    };
  }

  totalRefundedAmountUSD(account: string) {
    return (
      this.state.totalRefundedAmountUSDByAddressForYear[account] || ZERO_BN
    );
  }

  isMaxPSPGlobalBudgetSpent() {
    return this.state.totalPSPRefundedForYear.isGreaterThanOrEqualTo(
      MAX_PSP_GLOBAL_BUDGET_YEARLY,
    );
  }

  isAccountUSDBudgetSpent(account: string) {
    return this.totalRefundedAmountUSD(account).isGreaterThanOrEqualTo(
      MAX_USD_ADDRESS_BUDGET_YEARLY,
    );
  }

  assertMaxPSPGlobalBudgetNotReached() {
    assert(!this.isMaxPSPGlobalBudgetSpent(), 'Max PSP global budget spent');
  }

  increaseTotalAmountRefundedUSDForAccount(
    account: string,
    usdAmount: BigNumber | string,
  ) {
    this.state.totalRefundedAmountUSDByAddressForYear[account] =
      this.totalRefundedAmountUSD(account).plus(usdAmount);
  }

  increaseTotalPSPRefunded(amount: BigNumber | string) {
    this.state.totalPSPRefundedForYear = (
      this.state.totalPSPRefundedForYear || ZERO_BN
    ).plus(amount);
  }

  refundedAmountUSDForEpoch(account: string) {
    return (
      this.state.budgetStatePerEpoch.totalRefundedAmountUSDByAddressForEpoch[
        account
      ] || ZERO_BN
    );
  }

  isAccountUSDBudgetSpentForEpoch(account: string) {
    return this.refundedAmountUSDForEpoch(account).isGreaterThanOrEqualTo(
      MAX_USD_ADDRESS_BUDGET_EPOCH,
    );
  }

  increaseRefundedAmountUSDForEpoch(
    account: string,
    usdAmount: BigNumber | string,
  ) {
    this.state.budgetStatePerEpoch.totalRefundedAmountUSDByAddressForEpoch[
      account
    ] = this.refundedAmountUSDForEpoch(account).plus(usdAmount);
  }
}
