import { assert } from 'ts-essentials';
import { HistoricalPrice, TxFeesByAddress, StakedPSPByAddress } from '../types';
import { BigNumber } from 'bignumber.js';
import { constructSameDayPrice } from '../psp-chaincurrency-pricing';
import {
  readPendingEpochData,
  writePendingEpochData,
} from '../persistance/db-persistance';
import { getSwapsForAccounts } from './swaps-subgraph';
import {
  getRefundPercent,
  PendingEpochGasRefundData,
} from '../../../src/lib/gas-refund';
import { getTransactionGasUsed } from '../staking/covalent';

// empirically set to maximise on processing time without penalising memory and fetching constraigns
// @FIXME: fix swaps subgraph pagination to always stay on safest spot
const SLICE_DURATION = 3 * 24 * 60 * 60;

export async function computeSuccessfulSwapsTxFeesRefund({
  chainId,
  startTimestamp,
  endTimestamp,
  pspNativeCurrencyDailyRate,
  epoch,
  stakes,
}: {
  chainId: number;
  startTimestamp: number;
  endTimestamp: number;
  pspNativeCurrencyDailyRate: HistoricalPrice;
  epoch: number;
  stakes: StakedPSPByAddress;
}): Promise<void> {
  const logger = global.LOGGER(
    `GRP:TRANSACTION_FEES_INDEXING: epoch=${epoch}, chainId=${chainId}`,
  );

  const findSameDayPrice = constructSameDayPrice(pspNativeCurrencyDailyRate);
  const stakersAddress = Object.keys(stakes);

  logger.info(
    `swapTracker start indexing between ${startTimestamp} and ${endTimestamp}`,
  );

  let [accumulatedTxFeesByAddress, veryLastTimestampProcessed] =
    await readPendingEpochData({
      chainId,
      epoch,
    });

  const _startTimestamp = Math.max(
    startTimestamp,
    veryLastTimestampProcessed + 1,
  );

  for (
    let _startTimestampSlice = _startTimestamp;
    _startTimestampSlice < endTimestamp;
    _startTimestampSlice += SLICE_DURATION
  ) {
    const _endTimestampSlice = Math.min(
      _startTimestampSlice + SLICE_DURATION,
      endTimestamp,
    );

    logger.info(
      `start indexing partition between ${_startTimestampSlice} and ${_endTimestampSlice}`,
    );

    const swaps = await getSwapsForAccounts({
      startTimestamp: _startTimestampSlice,
      endTimestamp: _endTimestampSlice,
      accounts: stakersAddress,
      chainId,
    });

    logger.info(
      `fetched ${swaps.length} swaps withing _startTimestampSlice=${_startTimestampSlice} and _endTimestampSlice=${_endTimestampSlice}`,
    );

    const swapsWithGasUsed = await Promise.all(
      swaps.map(async swap => ({
        ...swap,
        txGasUsed: await getTransactionGasUsed({
          chainId,
          txHash: swap.txHash,
        }),
      })),
    );

    accumulatedTxFeesByAddress = swapsWithGasUsed.reduce<TxFeesByAddress>(
      (acc, swap) => {
        const address = swap.txOrigin;

        const swapperAcc = acc[address];

        const pspRateSameDay = findSameDayPrice(swap.timestamp);

        if (!pspRateSameDay) {
          logger.warn(
            `Fail to find price for same day ${
              swap.timestamp
            } and rates=${JSON.stringify(
              pspNativeCurrencyDailyRate.flatMap(p => p.timestamp),
            )}`,
          );

          return acc;
        }

        const currGasUsed = new BigNumber(swap.txGasUsed);
        const accumulatedGasUsed = currGasUsed.plus(
          swapperAcc?.accumulatedGasUsed || 0,
        );

        const currGasUsedChainCur = currGasUsed.multipliedBy(
          swap.txGasPrice.toString(),
        ); // in wei

        const accumulatedGasUsedChainCurrency = currGasUsedChainCur.plus(
          swapperAcc?.accumulatedGasUsedChainCurrency || 0,
        );

        const currGasFeePSP = currGasUsedChainCur.dividedBy(pspRateSameDay);

        const accumulatedGasUsedPSP = currGasFeePSP.plus(
          swapperAcc?.accumulatedGasUsedPSP || 0,
        );

        const totalStakeAmountPSP = stakes[address];
        const refundPercent = getRefundPercent(totalStakeAmountPSP);
        assert(
          refundPercent,
          `Logic Error: failed to find refund percent for ${address}`,
        );
        const currRefundedAmountPSP = currGasFeePSP.multipliedBy(refundPercent);

        const accRefundedAmountPSP = currRefundedAmountPSP.plus(
          swapperAcc?.refundedAmountPSP || 0,
        );

        const pendingGasRefundDatum: PendingEpochGasRefundData = {
          epoch,
          address,
          chainId,
          accumulatedGasUsedPSP: accumulatedGasUsedPSP.toFixed(0),
          accumulatedGasUsed: accumulatedGasUsed.toFixed(0),
          accumulatedGasUsedChainCurrency:
            accumulatedGasUsedChainCurrency.toFixed(0),
          firstBlock: swapperAcc?.lastBlock || swap.blockNumber,
          lastBlock: swap.blockNumber,
          totalStakeAmountPSP,
          refundedAmountPSP: accRefundedAmountPSP.toFixed(0),
          firstTx: swapperAcc?.firstTx || swap.txHash,
          lastTx: swap.txHash,
          firstTimestamp: swapperAcc?.firstTimestamp || swap.timestamp,
          lastTimestamp: swap.timestamp,
          numTx: (swapperAcc?.numTx || 0) + 1,
          isCompleted: false,
          updated: true,
        };

        acc[address] = pendingGasRefundDatum;

        return acc;
      },
      accumulatedTxFeesByAddress,
    );

    const updatedData = Object.values(accumulatedTxFeesByAddress).filter(
      v => v.updated,
    );
    if (updatedData.length > 0) {
      await writePendingEpochData(updatedData);
    }
  }

  logger.info(
    `computed accumulated tx fees for ${
      Object.keys(accumulatedTxFeesByAddress).length
    } addresses`,
  );
}
