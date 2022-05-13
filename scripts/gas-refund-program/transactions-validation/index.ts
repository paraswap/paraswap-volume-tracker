import { Op } from 'sequelize';
import { TransactionStatus } from '../../../src/lib/gas-refund';
import { GasRefundTransaction } from '../../../src/models/GasRefundTransaction';
import {
  fetchLastEpochProcessed,
  overrideTransactionStatus,
} from '../persistance/db-persistance';
import {
  GRPMaxLimitGuardian,
  MAX_PSP_GLOBAL_BUDGET,
  MAX_USD_ADDRESS_BUDGET,
} from './max-limit-guardian';

/**
 * This function guarantees that the order of transactions take into account for an address is always stable.
 * This is particular important as we approach the local (by address) or the global limit.
 * Because some transactions from some data source can arrive later, we need to reassess the status of all transactions for all chains for whole epoch.
 *
 * The solution is to:
 * - load current guard state in memory
 * - scan all transaction since last epoch processed in batch
 * - increase by address and globally with help of guardian
 * - write back to database the status of the transaction
 */
export async function validateTransactions() {
  const guardian = GRPMaxLimitGuardian.getInstance();

  const lastEpochProcessed = await fetchLastEpochProcessed();

  // reload overal state till last epoch processed (edxclusive)
  await guardian.loadStateFromDB(lastEpochProcessed);

  let offset = 0;
  const pageSize = 1000;

  while (true) {
    // scan transactions in batch sorted by timestamp and hash to guarantee stability
    const transactionsSlice = await GasRefundTransaction.findAll({
      where: {
        epoch: {
          [Op.gte]: lastEpochProcessed,
        },
      },
      order: ['timestamp', 'hash'],
      limit: pageSize,
      offset,
      attributes: [
        'chainId',
        'epoch',
        'hash',
        'address',
        'status',
        'refundedAmountPSP',
        'refundedAmountUSD',
      ],
    });

    if (!transactionsSlice.length) break;

    offset += pageSize;

    const transactionsWithUpdatedStatus = [];

    for (const tx of transactionsSlice) {
      let newStatus;

      const isGlobalLimitReached =
        guardian.systemState.totalPSPRefunded
          .plus(tx.refundedAmountPSP)
          .isGreaterThan(MAX_PSP_GLOBAL_BUDGET) ||
        guardian.isMaxPSPGlobalBudgetSpent();

      const isLocalLimitReached =
        guardian
          .totalRefundedAmountUSD(tx.address)
          .plus(tx.refundedAmountUSD)
          .isGreaterThan(MAX_USD_ADDRESS_BUDGET) ||
        guardian.isAccountUSDBudgetSpent(tx.address);

      // once one limit is reached, reject tx. Note: this would let refund future transactions that are still within the limit
      if (isLocalLimitReached || isGlobalLimitReached) {
        newStatus = TransactionStatus.REJECTED;
      } else {
        newStatus = TransactionStatus.VALIDATED;

        guardian.increaseTotalAmountRefundedUSDForAccount(
          tx.address,
          tx.refundedAmountUSD,
        );

        guardian.increaseTotalPSPRefunded(tx.refundedAmountPSP);
      }

      if (tx.status !== newStatus) {
        transactionsWithUpdatedStatus.push({
          ...tx,
          status: newStatus,
        });
      }
    }

    await overrideTransactionStatus(transactionsWithUpdatedStatus);

    if (transactionsSlice.length < pageSize) break; // micro opt to avoid querying db for last page
  }
}
