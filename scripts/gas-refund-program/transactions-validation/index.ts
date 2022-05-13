import { TransactionStatus } from '../../../src/lib/gas-refund';
import { GasRefundTransaction } from '../../../src/models/GasRefundTransaction';
import { writeTransactions } from '../persistance/db-persistance';
import {
  GRPMaxLimitGuardian,
  MAX_PSP_GLOBAL_BUDGET,
  MAX_USD_ADDRESS_BUDGET,
} from './max-limit-guardian';

export async function validateTransactions() {
  const guardian = GRPMaxLimitGuardian.getInstance();

  // reload total spent per user
  await guardian.loadStateFromDB();

  // scan idle transactions sorted by timestamp and hash
  let offset = 0;
  const pageSize = 100;

  while (true) {
    const transactionsSlice = await GasRefundTransaction.findAll({
      where: {
        status: TransactionStatus.IDLE,
      },
      order: ['timestamp', 'hash'],
      limit: pageSize,
      offset,
    });

    if (!transactionsSlice.length) break;

    offset += pageSize;

    for (const tx of transactionsSlice) {
      const willCrossGlobalLimit = guardian.systemState.totalPSPRefunded // if max limit is reached all next one will be flagged rejected
        .plus(tx.refundedAmountPSP)
        .isGreaterThan(MAX_PSP_GLOBAL_BUDGET);

      const willCrossLocalLimit = guardian
        .totalRefundedAmountUSD(tx.address)
        .plus(tx.refundedAmountUSD)
        .isGreaterThan(MAX_USD_ADDRESS_BUDGET);

      if (willCrossLocalLimit || willCrossGlobalLimit) {
        tx.status = TransactionStatus.REJECTED;
      } else {
        tx.status = TransactionStatus.VALIDATED;

        guardian.increaseTotalAmountRefundedUSDForAccount(
          tx.address,
          tx.refundedAmountUSD,
        );

        guardian.increaseTotalPSPRefunded(tx.refundedAmountPSP);
      }
    }

    await writeTransactions(transactionsSlice);
  }
}
