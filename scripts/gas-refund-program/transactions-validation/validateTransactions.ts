import { Op } from 'sequelize';
import { assert } from 'ts-essentials';
import {
  GasRefundGenesisEpoch,
  TransactionStatus,
} from '../../../src/lib/gas-refund';
import { GasRefundTransaction } from '../../../src/models/GasRefundTransaction';
import {
  fetchLastEpochRefunded,
  overrideTransactionStatus,
} from '../persistance/db-persistance';
import {
  GRPBudgetGuardian,
  MAX_PSP_GLOBAL_BUDGET,
  MAX_USD_ADDRESS_BUDGET,
} from './GRPBudgetGuardian';

/**
 * This function guarantees that the order of transactions refunded to be always stable.
 * This is particular important as we approach either per-address budget or global budget limit.
 * Because some transactions from some data source can arrive later, we need to reassess the status of all transactions for all chains for whole epoch.
 *
 * The solution is to:
 * - load current budgetGuardian to get snapshot of budgets spent
 * - scan all transaction since last epoch processed in batch
 * - flag each transaction as either validated or rejected if it reached the budget
 * - update in memory budget accountability through budgetGuardian on validated transactions
 * - write back status of tx in database
 */
export async function validateTransactions() {
  const guardian = GRPBudgetGuardian.getInstance();

  const lastEpochRefunded = await fetchLastEpochRefunded();
  const startEpochForTxValidation = !lastEpochRefunded
    ? GasRefundGenesisEpoch
    : lastEpochRefunded + 1;

  // reload budget guardian state till last epoch refunded (exclusive)
  await guardian.loadStateFromDB(startEpochForTxValidation);

  let offset = 0;
  const pageSize = 1000;

  while (true) {
    // scan transactions in batch sorted by timestamp and hash to guarantee stability
    const transactionsSlice = await GasRefundTransaction.findAll({
      where: {
        epoch: {
          [Op.gte]: startEpochForTxValidation,
        },
      },
      order: ['timestamp', 'hash'],
      limit: pageSize,
      offset,
      raw: true,
      attributes: [
        'id',
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
        guardian.state.totalPSPRefunded
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

    if (transactionsWithUpdatedStatus.length > 0) {
      await overrideTransactionStatus(transactionsWithUpdatedStatus);
    }

    if (transactionsSlice.length < pageSize) break; // micro opt to avoid querying db for last page
  }

  const numOfIdleTxs = await GasRefundTransaction.count({
    where: { status: TransactionStatus.IDLE },
  });

  assert(
    numOfIdleTxs === 0,
    `there should be 0 idle transactions at the end of validation step`,
  );
}
