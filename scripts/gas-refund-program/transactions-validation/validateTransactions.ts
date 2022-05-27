import BigNumber from 'bignumber.js';
import { Op } from 'sequelize';
import { assert } from 'ts-essentials';
import {
  GasRefundGenesisEpoch,
  getRefundPercent,
  TransactionStatus,
} from '../../../src/lib/gas-refund';
import { GasRefundTransaction } from '../../../src/models/GasRefundTransaction';
import {
  fetchLastEpochRefunded,
  updateTransactionsStatusRefundedAmounts,
} from '../persistance/db-persistance';
import { xnor } from '../../../src/lib/utils/helpers';
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
        'totalStakeAmountPSP',
        'gasUsedChainCurrency',
        'pspChainCurrency',
        'pspUsd',
        'refundedAmountUSD',
        'refundedAmountPSP',
      ],
    });

    if (!transactionsSlice.length) break;

    offset += pageSize;

    const updatedTransactions = [];

    for (const tx of transactionsSlice) {
      const {
        address,
        status,
        totalStakeAmountPSP,
        gasUsedChainCurrency,
        pspChainCurrency,
        pspUsd,
      } = tx;
      let newStatus;

      const refundPercentage = getRefundPercent(totalStakeAmountPSP);

      assert(refundPercentage, 'refundPercentage should be defined and > 0');

      // recompute refundedAmountPSP/refundedAmountUSD as logic alters those values as we reach limits
      const refundedAmountPSP = new BigNumber(gasUsedChainCurrency)
        .dividedBy(pspChainCurrency)
        .multipliedBy(refundPercentage)
        .decimalPlaces(0);

      const refundedAmountUSD = refundedAmountPSP
        .multipliedBy(pspUsd)
        .dividedBy(10 ** 18); // psp decimals always encoded in 18decimals

      let cappedRefundedAmountPSP;
      let cappedRefundedAmountUSD;

      const isGlobalLimitReached = guardian.isMaxPSPGlobalBudgetSpent();
      const isPerAccountLimitReached =
        guardian.isAccountUSDBudgetSpent(address);

      if (isGlobalLimitReached || isPerAccountLimitReached) {
        newStatus = TransactionStatus.REJECTED;
      } else {
        newStatus = TransactionStatus.VALIDATED;

        if (
          guardian
            .totalRefundedAmountUSD(address)
            .plus(refundedAmountUSD)
            .isGreaterThan(MAX_USD_ADDRESS_BUDGET)
        ) {
          cappedRefundedAmountUSD = MAX_USD_ADDRESS_BUDGET.minus(
            guardian.totalRefundedAmountUSD(address),
          );

          assert(
            cappedRefundedAmountUSD.isGreaterThanOrEqualTo(0),
            'Logic Error: quantity cannot be negative, this would mean we priorly refunded more than max',
          );

          cappedRefundedAmountPSP = cappedRefundedAmountUSD
            .dividedBy(pspUsd)
            .multipliedBy(10 ** 18)
            .decimalPlaces(0);
        }

        if (
          guardian.state.totalPSPRefunded
            .plus(cappedRefundedAmountPSP || refundedAmountPSP)
            .isGreaterThan(MAX_PSP_GLOBAL_BUDGET)
        ) {
          // Note: updating refundedAmountUSD does not matter if global budget limit is reached
          const cappedToMax = MAX_PSP_GLOBAL_BUDGET.minus(
            guardian.state.totalPSPRefunded,
          );

          // if transaction has been capped in upper handling, take min to avoid accidentally pushing per address limit
          cappedRefundedAmountPSP = cappedRefundedAmountPSP
            ? BigNumber.min(cappedRefundedAmountPSP, cappedToMax)
            : cappedToMax;

          assert(
            cappedRefundedAmountPSP.lt(refundedAmountPSP),
            'the capped amount should be lower than original one',
          );
        }

        guardian.increaseTotalAmountRefundedUSDForAccount(
          address,
          cappedRefundedAmountUSD || refundedAmountUSD,
        );

        guardian.increaseTotalPSPRefunded(
          cappedRefundedAmountPSP || refundedAmountPSP,
        );
      }

      assert(
        xnor(cappedRefundedAmountPSP, cappedRefundedAmountUSD),
        'Either both cappedRefundedAmountPSP and cappedRefundedAmountUSD should be falsy or truthy',
      );

      if (status !== newStatus || !!cappedRefundedAmountPSP) {
        updatedTransactions.push({
          ...tx,
          ...(!!cappedRefundedAmountPSP
            ? { refundedAmountPSP: cappedRefundedAmountPSP.toFixed(0) }
            : {}),
          ...(!!cappedRefundedAmountUSD
            ? { refundedAmountUSD: cappedRefundedAmountUSD.toFixed() } // purposefully not rounded to preserve dollar amount precision [IMPORTANT FOR CALCULCATIONS]
            : {}),
          status: newStatus,
        });
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
