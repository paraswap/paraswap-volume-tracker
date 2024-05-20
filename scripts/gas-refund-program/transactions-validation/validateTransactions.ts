import BigNumber from 'bignumber.js';
import { Op } from 'sequelize';
import { assert } from 'ts-essentials';
import {
  GasRefundBudgetLimitEpochBasedStartEpoch,
  GasRefundGenesisEpoch,
  GasRefundPrecisionGlitchRefundedAmountsEpoch,
  GasRefundDeduplicationStartEpoch,
  GasRefundV2EpochFlip,
  getRefundPercent,
  TOTAL_EPOCHS_IN_YEAR,
  TransactionStatus,
  GRP_MAX_REFUND_PERCENT,
} from '../../../src/lib/gas-refund/gas-refund';
import { GasRefundTransaction } from '../../../src/models/GasRefundTransaction';
import {
  fetchLastEpochRefunded,
  updateTransactionsStatusRefundedAmounts,
} from '../persistance/db-persistance';
import { xnor } from '../../../src/lib/utils/helpers';
import {
  GRPBudgetGuardian,
  MAX_PSP_GLOBAL_BUDGET_YEARLY,
  MAX_USD_ADDRESS_BUDGET_YEARLY,
} from './GRPBudgetGuardian';
import {
  fetchMigrationsTxHashesSet,
  MIGRATION_SEPSP2_100_PERCENT_KEY,
} from '../staking/2.0/utils';

import {
  constructFetchParaBoostPerAccountMem,
  ParaBoostPerAccount,
} from './paraBoost';
import { getCurrentEpoch } from '../../../src/lib/gas-refund/epoch-helpers';

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
const logger = global.LOGGER('GRP::validateTransactions');

// computing chainId_txHash so no need to assume anything about tx hashes collision across all chains
const hashKey = (t: GasRefundTransaction) => `${t.chainId}_${t.hash}`;

const paraBoostFetcher = constructFetchParaBoostPerAccountMem();

let paraBoostByAccount: ParaBoostPerAccount;

export async function validateTransactions() {
  const guardian = GRPBudgetGuardian.getInstance();

  const lastEpochRefunded = await fetchLastEpochRefunded();
  const migrationsTxsHashesSet = await fetchMigrationsTxHashesSet();

  const firstEpochOfYear = !!lastEpochRefunded // Verify logic add assert?
    ? GasRefundGenesisEpoch +
      lastEpochRefunded -
      (lastEpochRefunded % TOTAL_EPOCHS_IN_YEAR)
    : GasRefundGenesisEpoch;

  const startEpochForTxValidation = !lastEpochRefunded
    ? firstEpochOfYear
    : lastEpochRefunded + 1;

  // reload budget guardian state till last epoch refunded (exclusive)
  await guardian.loadStateFromDB(firstEpochOfYear, startEpochForTxValidation);

  let offset = 0;
  const pageSize = 1000;

  const uniqTxHashesForEpoch = new Set<string>();

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
        'gasUsedUSD',
        'contract',
      ],
    });

    if (!transactionsSlice.length) {
      break;
    }

    offset += pageSize;

    const updatedTransactions = [];

    let prevEpoch = transactionsSlice[0].epoch;

    if (prevEpoch >= GasRefundV2EpochFlip) {
      paraBoostByAccount = await paraBoostFetcher(prevEpoch);
    }

    for (const tx of transactionsSlice) {
      const {
        address,
        status,
        totalStakeAmountPSP,
        gasUsedChainCurrency,
        pspChainCurrency,
        pspUsd,
      } = tx;

      assert(
        tx.hash == tx.hash.toLowerCase(),
        'Logic Error: hashes should always be lowercased',
      );

      let newStatus;

      // a migration from staking V1 to V2 should be refunded exactly once
      // as staking txs are subject to refunding, we have to prevent double spending on marginal cases
      const isMigrationToV2Tx =
        tx.contract === MIGRATION_SEPSP2_100_PERCENT_KEY;

      if (isMigrationToV2Tx) {
        assert(
          migrationsTxsHashesSet.has(tx.hash),
          'Logic Error: migration txs set should always be containing all txs before running validation',
        );
      }

      if (prevEpoch !== tx.epoch) {
        // clean epoch based state on each epoch change
        guardian.resetEpochBudgetState();

        // clean yearly based state every 26 epochs
        if ((tx.epoch - GasRefundGenesisEpoch) % TOTAL_EPOCHS_IN_YEAR === 0) {
          guardian.resetYearlyBudgetState();
        }

        uniqTxHashesForEpoch.clear();

        // refetch paraBoost data on epoch switch
        if (tx.epoch >= GasRefundV2EpochFlip) {
          paraBoostByAccount = await paraBoostFetcher(tx.epoch);
        }

        prevEpoch = tx.epoch;
      }

      let refundPercentage: number | undefined;

      //  GRP2.0: take into account boost at end of epoch
      const isGRP2GracePeriod =
        tx.epoch >= GasRefundV2EpochFlip && getCurrentEpoch() > tx.epoch;

      if (isGRP2GracePeriod) {
        assert(paraBoostByAccount, 'paraBoostByAccount should be defined');
        const paraBoostFactor = paraBoostByAccount[tx.address] || 1;
        const fullParaBoostScore = new BigNumber(totalStakeAmountPSP)
          .multipliedBy(paraBoostFactor)
          .decimalPlaces(0, BigNumber.ROUND_DOWN)
          .toFixed();

        refundPercentage = getRefundPercent(tx.epoch, fullParaBoostScore);
      } else {
        // fall here on GRP1 and GRP2 during epoch
        refundPercentage = getRefundPercent(tx.epoch, totalStakeAmountPSP);
      }

      assert(
        typeof refundPercentage === 'number',
        'logic error: refunded percent should be defined',
      );

      if (tx.epoch < GasRefundV2EpochFlip) {
        assert(
          refundPercentage > 0,
          'logic error: refundPercentage should be > 0 on grp1.0',
        );
      }

      // GRP1.0: recompute refunded amounts as logic alters those values as we reach limits
      // GRP2.0: like GRP1.0 but also recompute refunded amounts after end of epoch to account for boosts
      let _refundedAmountPSP = new BigNumber(gasUsedChainCurrency)
        .dividedBy(pspChainCurrency)
        .multipliedBy(refundPercentage || 0); // keep it decimals to avoid rounding errors

      if (tx.epoch === GasRefundPrecisionGlitchRefundedAmountsEpoch) {
        _refundedAmountPSP = _refundedAmountPSP.decimalPlaces(0);
      }

      const recomputedRefundedAmountUSD = _refundedAmountPSP
        .multipliedBy(pspUsd)
        .dividedBy(10 ** 18); // psp decimals always encoded in 18decimals

      const recomputedRefundedAmountPSP = _refundedAmountPSP.decimalPlaces(0); // truncate decimals to align with values in db

      let cappedRefundedAmountPSP: BigNumber | undefined;
      let cappedRefundedAmountUSD: BigNumber | undefined;

      // (guardian.isMaxYearlyPSPGlobalBudgetSpent() ||
      //     guardian.hasSpentYearlyUSDBudget(address) ||
      //     (tx.epoch >= GasRefundBudgetLimitEpochBasedStartEpoch &&
      //       guardian.hasSpentUSDBudgetForEpoch(address, tx.epoch)) ||
      //     (tx.epoch >= GasRefundDeduplicationStartEpoch &&
      //       uniqTxHashesForEpoch.has(hashKey(tx))) || // prevent double spending overall
      //     migrationsTxsHashesSet.has(tx.hash)) // avoid double spending for twin migration txs (with contract set to actual contract address). Order of txs matters
      const rejectReasons = {
        yearlyPSP: guardian.isMaxYearlyPSPGlobalBudgetSpent(),
        yearlyUSD: guardian.hasSpentYearlyUSDBudget(address),
        epochUSD:
          tx.epoch >= GasRefundBudgetLimitEpochBasedStartEpoch &&
          guardian.hasSpentUSDBudgetForEpoch(address, tx.epoch),
        deduplication:
          tx.epoch >= GasRefundDeduplicationStartEpoch &&
          uniqTxHashesForEpoch.has(hashKey(tx)),
        migration: migrationsTxsHashesSet.has(tx.hash),
      };

      const truthyRectionReasons = Object.entries(rejectReasons).filter(
        ([_, value]) => value,
      );

      if (
        !isMigrationToV2Tx && // always refund migration txs (100%)
        truthyRectionReasons.length > 0
      ) {
        debugger;
        newStatus = TransactionStatus.REJECTED;
      } else {
        newStatus = TransactionStatus.VALIDATED;

        // should never cap migration txs
        if (isMigrationToV2Tx) {
          assert(
            Math.abs(+tx.refundedAmountUSD - +tx.gasUsedUSD) < 10 ** -4, // epsilon value
            'logic error: migration tx should always be valid and get fully refunded',
          );
        } else {
          ({ cappedRefundedAmountPSP, cappedRefundedAmountUSD } =
            tx.epoch < GasRefundBudgetLimitEpochBasedStartEpoch
              ? capRefundedAmountsBasedOnYearlyDollarBudget(
                  address,
                  recomputedRefundedAmountUSD,
                  pspUsd,
                )
              : capRefundedAmountsBasedOnEpochDollarBudget(
                  address,
                  recomputedRefundedAmountUSD,
                  pspUsd,
                  tx.epoch,
                ));

          cappedRefundedAmountPSP = capRefundedPSPAmountBasedOnYearlyPSPBudget(
            cappedRefundedAmountPSP,
            recomputedRefundedAmountPSP,
          );

          if (tx.epoch >= GasRefundBudgetLimitEpochBasedStartEpoch) {
            guardian.increaseRefundedUSDForEpoch(
              address,
              cappedRefundedAmountUSD || recomputedRefundedAmountUSD,
            );
          }

          guardian.increaseYearlyRefundedUSD(
            address,
            cappedRefundedAmountUSD || recomputedRefundedAmountUSD,
          );

          guardian.increaseTotalRefundedPSP(
            cappedRefundedAmountPSP || recomputedRefundedAmountPSP,
          );
        }
      }

      assert(
        xnor(cappedRefundedAmountPSP, cappedRefundedAmountUSD),
        'Either both cappedRefundedAmountPSP and cappedRefundedAmountUSD should be falsy or truthy',
      );

      uniqTxHashesForEpoch.add(hashKey(tx));

      if (tx.epoch < GasRefundV2EpochFlip) {
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
      } else {
        assert(paraBoostByAccount, 'paraBoostByAccount should be defined'); // important for next invariant check
        const paraBoostFactor = paraBoostByAccount[tx.address] || 1; // it can happen that user was staked during epoch but unstaked later, in such case boost is lost

        const updatedTx = {
          ...tx,
          status: newStatus,
          paraBoostFactor,
        };

        if (isMigrationToV2Tx) {
          // not safe to take
          assert(
            tx.contract === MIGRATION_SEPSP2_100_PERCENT_KEY,
            'logic error should have migration txs here',
          );
          assert(
            newStatus == TransactionStatus.VALIDATED,
            'migration txs can only be valided',
          );
          // as logic up doesn't prevent recalculating refunded amount migration txs.
          // use this as an opportunity to check multiple invariant
          // - migration tx should alwasys be refunded 100%
          // - computed refund should never go > 95%
          assert(
            BigInt(tx.refundedAmountPSP) >
              BigInt(recomputedRefundedAmountPSP.toFixed(0)),
            'refunded amount PSP should always be strictly here thn recomputed amount',
          );
          updatedTransactions.push(updatedTx);
        } else {
          assert(
            refundPercentage <= GRP_MAX_REFUND_PERCENT,
            'refunded percent should be computed and lower than max',
          );
          const updatedRefundedAmountPSP = (
            cappedRefundedAmountPSP || recomputedRefundedAmountPSP
          ).toFixed(0);
          const updatedRefundedAmountUSD = (
            cappedRefundedAmountUSD || recomputedRefundedAmountUSD
          ).toFixed();

          if (refundPercentage == 0) {
            assert(
              updatedRefundedAmountPSP === '0' &&
                updatedRefundedAmountUSD === '0',
              'logic error',
            );
          } else {
            assert(
              updatedRefundedAmountPSP !== '0' &&
                updatedRefundedAmountUSD !== '0',
              'logic error',
            );
          }

          if (tx.refundedAmountPSP !== updatedRefundedAmountPSP) {
            assert(
              tx.refundedAmountUSD !== updatedRefundedAmountUSD,
              'should always update usd amount along with psp amount',
            );

            if (paraBoostFactor > 1) {
              if (refundPercentage < GRP_MAX_REFUND_PERCENT) {
                // amend: asserts do not make sense here
                // assert(
                //   BigInt(tx.refundedAmountPSP) <
                //     BigInt(recomputedRefundedAmountPSP.toFixed(0)),
                //   'logic error: account has boost, recomputed amount should be higher',
                // );
              } else {
                assert(
                  BigInt(tx.refundedAmountPSP) <=
                    BigInt(recomputedRefundedAmountPSP.toFixed(0)),
                  'logic error: account has boost, recomputed amount should be at least higher than previous on max',
                );
              }
            }

            updatedTransactions.push({
              ...updatedTx,
              refundedAmountPSP: updatedRefundedAmountPSP,
              refundedAmountUSD: updatedRefundedAmountUSD,
            });
          } else {
            // can land here if account has 0 or recomputed amounts are exactly matching
            updatedTransactions.push(updatedTx);
          }
        }
      }
    }

    if (updatedTransactions.length > 0) {
      await updateTransactionsStatusRefundedAmounts(updatedTransactions);
    }

    if (transactionsSlice.length < pageSize) {
      break; // micro opt to avoid querying db for last page
    }
  }

  const numOfIdleTxs = await GasRefundTransaction.count({
    where: { status: TransactionStatus.IDLE },
  });

  assert(
    numOfIdleTxs === 0,
    `there should be 0 idle transactions at the end of validation step`,
  );
}

type CappedAmounts = {
  cappedRefundedAmountUSD: BigNumber | undefined;
  cappedRefundedAmountPSP: BigNumber | undefined;
};

function capRefundedAmountsBasedOnYearlyDollarBudget(
  address: string,
  refundedAmountUSD: BigNumber,
  pspUsd: number,
): CappedAmounts {
  const guardian = GRPBudgetGuardian.getInstance();
  let cappedRefundedAmountUSD;
  let cappedRefundedAmountPSP;

  if (
    guardian
      .totalYearlyRefundedUSD(address)
      .plus(refundedAmountUSD)
      .isGreaterThan(MAX_USD_ADDRESS_BUDGET_YEARLY)
  ) {
    cappedRefundedAmountUSD = MAX_USD_ADDRESS_BUDGET_YEARLY.minus(
      guardian.totalYearlyRefundedUSD(address),
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

  return { cappedRefundedAmountUSD, cappedRefundedAmountPSP };
}

function capRefundedAmountsBasedOnEpochDollarBudget(
  address: string,
  refundedAmountUSD: BigNumber,
  pspUsd: number,
  epoch: number,
): CappedAmounts {
  const guardian = GRPBudgetGuardian.getInstance();

  const maxUsdBudgetPerEpochPerAcc =
    guardian.getMaxRefundUSDBudgetForEpoch(epoch);

  if (
    guardian
      .totalYearlyRefundedUSD(address)
      .plus(refundedAmountUSD)
      .isGreaterThan(MAX_USD_ADDRESS_BUDGET_YEARLY)
  ) {
    return capRefundedAmountsBasedOnYearlyDollarBudget(
      address,
      refundedAmountUSD,
      pspUsd,
    );
  }

  let cappedRefundedAmountUSD;
  let cappedRefundedAmountPSP;

  if (
    guardian
      .totalRefundedUSDForEpoch(address)
      .plus(refundedAmountUSD)
      .isGreaterThan(maxUsdBudgetPerEpochPerAcc)
  ) {
    cappedRefundedAmountUSD = maxUsdBudgetPerEpochPerAcc.minus(
      guardian.totalRefundedUSDForEpoch(address),
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

  return { cappedRefundedAmountUSD, cappedRefundedAmountPSP };
}

function capRefundedPSPAmountBasedOnYearlyPSPBudget(
  cappedRefundedAmountPSP: BigNumber | undefined,
  refundedAmountPSP: BigNumber,
): BigNumber | undefined {
  const guardian = GRPBudgetGuardian.getInstance();

  const hasCrossedYearlyPSPBuget = guardian.state.totalPSPRefundedForYear
    .plus(cappedRefundedAmountPSP || refundedAmountPSP)
    .isGreaterThan(MAX_PSP_GLOBAL_BUDGET_YEARLY);

  if (!hasCrossedYearlyPSPBuget) {
    return cappedRefundedAmountPSP;
  }

  // Note: updating refundedAmountUSD does not matter if global budget limit is reached
  const cappedToMax = MAX_PSP_GLOBAL_BUDGET_YEARLY.minus(
    guardian.state.totalPSPRefundedForYear,
  );

  // if transaction has been capped in upper handling, take min to avoid accidentally pushing per address limit
  const _cappedRefundedAmountPSP = cappedRefundedAmountPSP
    ? BigNumber.min(cappedRefundedAmountPSP, cappedToMax)
    : cappedToMax;

  assert(
    _cappedRefundedAmountPSP.lt(refundedAmountPSP),
    'the capped amount should be lower than original one',
  );

  return _cappedRefundedAmountPSP;
}
