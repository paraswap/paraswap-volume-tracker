import BigNumber from 'bignumber.js';
import { Op } from 'sequelize';
import { assert } from 'ts-essentials';
import {
  GasRefundGenesisEpoch,
  TransactionStatus,
} from '../../../src/lib/gas-refund';
import { GasRefundTransaction } from '../../../src/models/GasRefundTransaction';
import {
  fetchLastEpochRefunded,
  updateTransactionsStatusRefundedAmounts,
} from '../persistance/db-persistance';
import {
  GRPBudgetGuardian,
  MAX_PSP_GLOBAL_BUDGET,
  MAX_USD_ADDRESS_BUDGET,
} from './GRPBudgetGuardian';

/**
 * This function guarantees that the order of transactions refunded will always be stable.
 * This is particularly important as we approach either per-address or global budget limit.
 * Because some transactions from some data source can arrive later, we need to reassess the status of all transactions for all chains for whole epoch.
 *
 * The solution is to:
 * - load current budgetGuardian to get snapshot of budgets spent
 * - scan all transaction since last epoch refunded in batch
 * - flag each transaction as either validated or rejected if it reached the budget
 * - update in memory budget accountability through budgetGuardian on validated transactions
 * - write back status of tx in database if changed
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
        'pspUsd',
      ],
    });

    if (!transactionsSlice.length) break;

    offset += pageSize;

    const updatedTransactions = [];

    for (const tx of transactionsSlice) {
      let { status } = tx;
      let refundedAmountPSP = new BigNumber(tx.refundedAmountPSP);
      let refundedAmountUSD = new BigNumber(tx.refundedAmountUSD);

      const isGlobalLimitReached = guardian.isMaxPSPGlobalBudgetSpent();
      const isPerAccountLimitReached = guardian.isAccountUSDBudgetSpent(
        tx.address,
      );

      if (isGlobalLimitReached || isPerAccountLimitReached) {
        status = TransactionStatus.REJECTED;
      } else {
        status = TransactionStatus.VALIDATED;

        if (
          guardian.state.totalPSPRefunded
            .plus(tx.refundedAmountPSP)
            .isGreaterThan(MAX_PSP_GLOBAL_BUDGET)
        ) {
          // Note: updating refundedAmountUSD does not matter if global budget limit is reached
          refundedAmountPSP = MAX_PSP_GLOBAL_BUDGET.minus(
            guardian.state.totalPSPRefunded,
          );

          assert(
            refundedAmountPSP.lt(tx.refundedAmountPSP),
            'the capped amount should be lower than original one',
          );
        } else if (
          guardian
            .totalRefundedAmountUSD(tx.address)
            .plus(tx.refundedAmountUSD)
            .isGreaterThan(MAX_USD_ADDRESS_BUDGET)
        ) {
          refundedAmountUSD = MAX_USD_ADDRESS_BUDGET.minus(
            guardian.totalRefundedAmountUSD(tx.address),
          );

          assert(
            refundedAmountUSD.isGreaterThanOrEqualTo(0),
            'Logic Error: quantity cannot be negative, this would mean we priorly refunded more than max',
          );

          refundedAmountPSP = refundedAmountUSD
            .dividedBy(tx.pspUsd)
            .multipliedBy(10 ** 18);
        }

        guardian.increaseTotalAmountRefundedUSDForAccount(
          tx.address,
          refundedAmountUSD,
        );

        guardian.increaseTotalPSPRefunded(refundedAmountPSP);

        if (tx.status !== status) {
          updatedTransactions.push({
            ...tx,
            ...(!refundedAmountPSP.isEqualTo(tx.refundedAmountPSP)
              ? { refundedAmountPSP: refundedAmountPSP.toFixed(0) }
              : {}),
            ...(!refundedAmountUSD.isEqualTo(tx.refundedAmountUSD)
              ? { refundedAmountUSD: refundedAmountUSD.toFixed() } // purposefully not rounded to preserve dollar amount precision [IMPORTANT FOR CALCULCATIONS]
              : {}),
            status,
          });
        }
      }
    }

    if (updatedTransactions.length > 0) {
      await updateTransactionsStatusRefundedAmounts(updatedTransactions);
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
