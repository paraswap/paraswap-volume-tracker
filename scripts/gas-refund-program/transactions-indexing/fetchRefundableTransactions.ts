import { assert } from 'ts-essentials';
import { BigNumber } from 'bignumber.js';
import {
  fetchLastTimestampTxByContract,
  writeTransactions,
  composeGasRefundTransactionStakeSnapshots,
  writeStakeScoreSnapshots,
  writeStakeScoreSnapshots_V3,
  composeGasRefundTransactionStakeSnapshots_V3,
} from '../persistance/db-persistance';
import { getAllTXs, getContractAddresses } from './transaction-resolver';
import {
  TransactionStatus,
  GasRefundV2EpochFlip,
  getRefundPercent,
  getMinStake,
  GasRefundV2PIP55,
} from '../../../src/lib/gas-refund/gas-refund';
import { ONE_HOUR_SEC } from '../../../src/lib/utils/helpers';
import { PriceResolverFn } from '../token-pricing/psp-chaincurrency-pricing';
import StakesTracker, { isStakeScoreV3 } from '../staking/stakes-tracker';
import { MIGRATION_SEPSP2_100_PERCENT_KEY } from '../staking/2.0/utils';
import { isTruthy } from '../../../src/lib/utils';
import {
  AUGUSTUS_SWAPPERS_V6_OMNICHAIN,
  AUGUSTUS_V5_ADDRESS,
} from '../../../src/lib/constants';
import { fetchParaswapV6StakersTransactions } from '../../../src/lib/paraswap-v6-stakers-transactions';
import { ExtendedCovalentGasRefundTransaction } from '../../../src/types-from-scripts';
import { GasRefundTransactionDataWithStakeScore, TxProcessorFn } from './types';
import { applyEpoch46Patch } from '../../per-epoch-patches/epoch-46';
import { applyEpoch48Patch } from '../../per-epoch-patches/epoch-48';
import { PatchInput } from '../../per-epoch-patches/types';
import type { Logger } from 'log4js';
import {
  isGasRefundTransactionStakeSnapshotData_V2_Arr,
  isGasRefundTransactionStakeSnapshotData_V3_Arr,
} from '../../../src/models/GasRefundTransactionStakeSnapshot_V3';

function constructTransactionsProcessor({
  chainId,
  endTimestamp,
  epoch,
  resolvePrice,
}: {
  chainId: number;
  endTimestamp: number;
  epoch: number;
  resolvePrice: PriceResolverFn;
}): TxProcessorFn {
  return async function filterAndFormatRefundableTransactions(
    transactions: ExtendedCovalentGasRefundTransaction[],
    computeRefundPercent: (
      epoch: number,
      totalPSPorTotalParaboostScore: string,
    ) => number | undefined,
  ) {
    const refundableTransactions: GasRefundTransactionDataWithStakeScore[] =
      transactions
        .map(transaction => {
          const address = transaction.txOrigin;

          // TODO: cleanup this quick tmp workaround
          if (
            +transaction.timestamp <
            new Date('2025-02-15').getTime() / 1000
          ) {
            return;
          }

          const stakeScore = StakesTracker.getInstance().computeStakeScore(
            address,
            +transaction.timestamp,
            epoch,
            endTimestamp,
          );

          if (stakeScore.combined.isLessThan(getMinStake(epoch))) {
            return;
          }

          const { txGasUsed, contract, gasSpentInChainCurrencyWei } =
            transaction;

          const currencyRate = resolvePrice(+transaction.timestamp);

          assert(
            currencyRate,
            `could not retrieve psp/chaincurrency same day rate for swap at ${transaction.timestamp}`,
          );

          const currGasUsedChainCur = transaction.txGasUsedUSD // if USD override is available, most likely it's delta -> adjust spent eth and psp to refund based on that
            ? new BigNumber(
                new BigNumber(transaction.txGasUsedUSD)
                  .multipliedBy(10 ** 18)
                  .dividedBy(currencyRate.chainPrice)
                  .toFixed(0),
              )
            : gasSpentInChainCurrencyWei
            ? new BigNumber(gasSpentInChainCurrencyWei)
            : new BigNumber(txGasUsed).multipliedBy(
                transaction.txGasPrice.toString(),
              ); // in wei

          const currGasUsedUSD = transaction.txGasUsedUSD
            ? new BigNumber(transaction.txGasUsedUSD)
            : currGasUsedChainCur
                .multipliedBy(currencyRate.chainPrice)
                .dividedBy(10 ** 18); // chaincurrency always encoded in 18decimals

          const currGasFeePSP = currGasUsedChainCur.dividedBy(
            currencyRate.pspToChainCurRate,
          );

          const totalStakeAmountPSP = stakeScore.combined.toFixed(0); // @todo irrelevant?
          const refundPercent = computeRefundPercent(
            epoch,
            totalStakeAmountPSP,
          );

          if (epoch < GasRefundV2EpochFlip) {
            assert(
              refundPercent,
              `Logic Error: failed to find refund percent for ${address}`,
            );
          }

          const currRefundedAmountPSP = currGasFeePSP.multipliedBy(
            refundPercent || 0,
          );

          const currRefundedAmountUSD = currRefundedAmountPSP
            .multipliedBy(currencyRate.pspPrice)
            .dividedBy(10 ** 18); // psp decimals always encoded in 18decimals

          if (currRefundedAmountPSP.lt(0)) {
            debugger;
          }
          const refundableTransaction: GasRefundTransactionDataWithStakeScore =
            {
              epoch,
              address,
              chainId,
              hash: transaction.txHash,
              block: +transaction.blockNumber,
              timestamp: +transaction.timestamp,
              gasUsed: txGasUsed,
              gasPrice: transaction.txGasPrice,
              gasUsedChainCurrency: currGasUsedChainCur.toFixed(0),
              pspUsd: currencyRate.pspPrice,
              chainCurrencyUsd: currencyRate.chainPrice,
              pspChainCurrency: currencyRate.pspToChainCurRate,
              gasUsedUSD: currGasUsedUSD.toFixed(), // purposefully not rounded to preserve dollar amount precision - purely debug / avoid 0$ values in db
              totalStakeAmountPSP,
              refundedAmountPSP: currRefundedAmountPSP.toFixed(0),
              refundedAmountUSD: currRefundedAmountUSD.toFixed(), // purposefully not rounded to preserve dollar amount precision [IMPORTANT FOR CALCULCATIONS]
              contract,
              status: TransactionStatus.IDLE,
              paraBoostFactor: 1,
              stakeScore,
            };

          return refundableTransaction;
        })
        .filter(isTruthy);

    return refundableTransactions;
  };
}

// empirically set to maximise on processing time without penalising memory and fetching constraigns
const SLICE_DURATION = 4 * ONE_HOUR_SEC;

export async function fetchRefundableTransactions({
  chainId,
  startTimestamp,
  endTimestamp,
  epoch,
  resolvePrice,
}: {
  chainId: number;
  startTimestamp: number;
  endTimestamp: number;
  epoch: number;
  resolvePrice: PriceResolverFn;
}): Promise<GasRefundTransactionDataWithStakeScore[]> {
  const logger = global.LOGGER(
    `GRP:fetchRefundableTransactions: epoch=${epoch}, chainId=${chainId}`,
  );

  logger.info(`start indexing between ${startTimestamp} and ${endTimestamp}`);

  const lastTimestampTxByContract = await fetchLastTimestampTxByContract({
    chainId,
    epoch,
  });

  let allButV6ContractAddresses = getContractAddresses({ epoch, chainId });

  if (epoch >= GasRefundV2PIP55) {
    // starting from epoch 56 we no longer refund augustus v5 txs
    allButV6ContractAddresses = allButV6ContractAddresses.filter(
      contract => contract !== AUGUSTUS_V5_ADDRESS,
    );
  }

  const processRawTxs = constructTransactionsProcessor({
    chainId,
    endTimestamp,
    epoch,
    resolvePrice,
  });

  const allTxsAndV6Combined = await Promise.all([
    // ...allButV6ContractAddresses.map(async contractAddress => {
    //   assert(contractAddress, 'contractAddress should be defined');
    //   const lastTimestampProcessed =
    //     lastTimestampTxByContract[contractAddress] || 0;

    //   const _startTimestamp = Math.max(
    //     startTimestamp,
    //     lastTimestampProcessed + 1,
    //   );

    //   // Step 1: Create an array of time slices
    //   const timeSlices = [];
    //   for (
    //     let _startTimestampSlice = _startTimestamp;
    //     _startTimestampSlice < endTimestamp;
    //     _startTimestampSlice += SLICE_DURATION
    //   ) {
    //     const _endTimestampSlice = Math.min(
    //       _startTimestampSlice + SLICE_DURATION,
    //       endTimestamp,
    //     );
    //     timeSlices.push({
    //       start: _startTimestampSlice,
    //       end: _endTimestampSlice,
    //     });
    //   }

    //   // Step 2: Map each slice to a promise
    //   const promises = timeSlices.map(({ start, end }) =>
    //     (async () => {
    //       logger.info(
    //         `fetching transactions between ${start} and ${end} for contract=${contractAddress}...`,
    //       );

    //       const transactions = await getAllTXs({
    //         epoch,
    //         startTimestamp: start,
    //         endTimestamp: end,
    //         chainId,
    //         epochEndTimestamp: endTimestamp,
    //         contractAddress,
    //       });

    //       logger.info(
    //         `fetched ${transactions.length} txs between ${start} and ${end} for contract=${contractAddress}`,
    //       );

    //       const refundableTransactions = await processRawTxs(
    //         transactions,
    //         (epoch, totalScore) => {
    //           const result =
    //             contractAddress === MIGRATION_SEPSP2_100_PERCENT_KEY
    //               ? 1 // 100% for migration tx
    //               : getRefundPercent(epoch, totalScore);
    //           return result;
    //         },
    //       );

    //       return refundableTransactions.length > 0
    //         ? refundableTransactions
    //         : [];
    //     })(),
    //   );

    //   // Step 3: Use Promise.all to execute all promises concurrently
    //   const result = await Promise.all(promises);

    //   // Step 4: Flatten the result and return
    //   return result.flat();
    // }),

    ...Array.from(AUGUSTUS_SWAPPERS_V6_OMNICHAIN)
      .concat(
        '0x0000000000bbf5c5fd284e657f01bd000933c96d', // delta v2
      )
      .map(async contractAddress => {
        const epochNewStyle = epoch - GasRefundV2EpochFlip;

        const lastTimestampProcessed =
          lastTimestampTxByContract[contractAddress];

        const allStakersTransactionsDuringEpoch =
          await fetchParaswapV6StakersTransactions({
            staking_version: 3,
            epoch: epochNewStyle,
            timestampGreaterThan: lastTimestampProcessed,
            chainId,
            address: contractAddress,
          });

        return await processRawTxs(
          allStakersTransactionsDuringEpoch,
          (epoch, totalUserScore) => getRefundPercent(epoch, totalUserScore),
        );
      }),
  ]);

  const flattened = allTxsAndV6Combined.flat();
  const withPatches = await addPatches({
    txs: flattened,
    epoch,
    processRawTxs,
    chainId,
  });
  await storeTxs({
    txsWithScores: withPatches,
    logger,
  });
  return withPatches;
}

export async function storeTxs({
  txsWithScores: refundableTransactions,
  logger,
}: {
  txsWithScores: GasRefundTransactionDataWithStakeScore[];
  logger: Logger;
}) {
  if (refundableTransactions.length > 0) {
    logger.info(
      `updating total of ${refundableTransactions.length} for this chan and epoch`,
    );
    await writeTransactions(refundableTransactions);

    const stakeScoreEntries = refundableTransactions
      .map(({ stakeScore, ...transaction }) =>
        (isStakeScoreV3(refundableTransactions[0]?.stakeScore)
          ? composeGasRefundTransactionStakeSnapshots_V3
          : composeGasRefundTransactionStakeSnapshots)(transaction, stakeScore),
      )
      .flat();

    if (isGasRefundTransactionStakeSnapshotData_V3_Arr(stakeScoreEntries)) {
      await writeStakeScoreSnapshots_V3(stakeScoreEntries);
    } else if (
      isGasRefundTransactionStakeSnapshotData_V2_Arr(stakeScoreEntries)
    ) {
      await writeStakeScoreSnapshots(stakeScoreEntries);
    } else {
      throw new Error('Unknown stake score snapshot data type');
    }
  }
}
async function addPatches({
  txs,
  epoch,
  processRawTxs,
  chainId,
}: PatchInput & { epoch: number }): Promise<
  GasRefundTransactionDataWithStakeScore[]
> {
  if (epoch === 46)
    return applyEpoch46Patch({
      txs,
      processRawTxs,
      chainId,
    });

  if (epoch === 48)
    return applyEpoch48Patch({
      txs,
      processRawTxs,
      chainId,
    });

  return txs;
}
