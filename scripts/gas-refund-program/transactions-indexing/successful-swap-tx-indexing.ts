import { assert } from 'ts-essentials';
import { TxFeesByAddress } from '../types';
import { BigNumber } from 'bignumber.js';
import {
  fetchPendingGasRefundData,
  fetchVeryLastTimestampProcessed,
  writePendingEpochData,
} from '../persistance/db-persistance';
import { getSuccessfulSwaps } from './swaps-subgraph';
import {
  GasRefundTxOriginCheckStartEpoch,
  getRefundPercent,
  GRP_MIN_STAKE,
  PendingEpochGasRefundData,
} from '../../../src/lib/gas-refund';
import { getTransactionGasUsed } from '../staking/covalent';
import * as _ from 'lodash';
import { ONE_HOUR_SEC } from '../utils';
import { PriceResolverFn } from '../token-pricing/psp-chaincurrency-pricing';
import GRPSystemGuardian, { MAX_USD_ADDRESS_BUDGET } from '../system-guardian';
import StakesTracker from '../staking/stakes-tracker';

// empirically set to maximise on processing time without penalising memory and fetching constraigns
const SLICE_DURATION = 6 * ONE_HOUR_SEC;

export async function computeSuccessfulSwapsTxFeesRefund({
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
}): Promise<void> {
  const logger = global.LOGGER(
    `GRP:TRANSACTION_FEES_INDEXING: epoch=${epoch}, chainId=${chainId}`,
  );

  logger.info(
    `swapTracker start indexing between ${startTimestamp} and ${endTimestamp}`,
  );

  const [accPendingGasRefundByAddress, veryLastTimestampProcessed] =
    await Promise.all([
      fetchPendingGasRefundData({ chainId, epoch }),
      fetchVeryLastTimestampProcessed({ chainId, epoch }),
    ]);

  const _startTimestamp = Math.max(
    startTimestamp,
    veryLastTimestampProcessed + 1,
  );

  for (
    let _startTimestampSlice = _startTimestamp;
    _startTimestampSlice < endTimestamp;
    _startTimestampSlice += SLICE_DURATION
  ) {
    if (GRPSystemGuardian.isMaxPSPGlobalBudgetSpent()) {
      logger.warn(
        `max psp global budget spent, preventing further processing & storing`,
      );
      break;
    }

    const _endTimestampSlice = Math.min(
      _startTimestampSlice + SLICE_DURATION,
      endTimestamp,
    );

    logger.info(
      `fetching stakers between ${_startTimestampSlice} and ${_endTimestampSlice}...`,
    );

    logger.info(
      `fetching swaps between ${_startTimestampSlice} and ${_endTimestampSlice}...`,
    );

    const swaps = await getSuccessfulSwaps({
      startTimestamp: _startTimestampSlice,
      endTimestamp: _endTimestampSlice,
      chainId,
    });

    logger.info(
      `fetched ${swaps.length} swaps between ${_startTimestampSlice} and ${_endTimestampSlice}`,
    );

    const updatedPendingGasRefundDataByAddress: TxFeesByAddress = {};

    await Promise.all(
      swaps.map(async swap => {
        if (
          epoch >= GasRefundTxOriginCheckStartEpoch &&
          swap.initiator !== swap.txOrigin
        ) {
          return;
        }

        const address = swap.txOrigin;

        const swapperStake =
          StakesTracker.getInstance().computeStakedPSPBalance(
            address,
            +swap.timestamp,
            epoch,
            endTimestamp,
          );

        if (swapperStake.isLessThan(GRP_MIN_STAKE)) {
          return;
        }

        const txGasUsed = await getTransactionGasUsed({
          chainId,
          txHash: swap.txHash,
        });

        if (GRPSystemGuardian.isMaxPSPGlobalBudgetSpent()) {
          logger.warn(
            `max psp global budget spent, preventing further processing & storing`,
          );
          return;
        }

        if (GRPSystemGuardian.isAccountUSDBudgetSpent(address)) {
          logger.warn(`Max budget already spent for ${address}`);
          return;
        }

        const currencyRate = resolvePrice(+swap.timestamp);

        assert(
          currencyRate,
          `could not retrieve psp/chaincurrency same day rate for swap at ${swap.timestamp}`,
        );

        const swapperAcc = accPendingGasRefundByAddress[address];

        const currGasUsed = new BigNumber(txGasUsed);
        const accumulatedGasUsed = currGasUsed.plus(
          swapperAcc?.accumulatedGasUsed || 0,
        );

        const currGasUsedChainCur = currGasUsed.multipliedBy(
          swap.txGasPrice.toString(),
        ); // in wei

        const accumulatedGasUsedChainCurrency = currGasUsedChainCur.plus(
          swapperAcc?.accumulatedGasUsedChainCurrency || 0,
        );

        const currGasUsedUSD = currGasUsedChainCur
          .multipliedBy(currencyRate.chainPrice)
          .dividedBy(10 ** 18); // chaincurrency always encoded in 18decimals

        const accumulatedGasUsedUSD = currGasUsedUSD.plus(
          swapperAcc?.accumulatedGasUsedUSD || 0,
        );
        const currGasFeePSP = currGasUsedChainCur.dividedBy(
          currencyRate.pspToChainCurRate,
        );

        const accumulatedGasUsedPSP = currGasFeePSP.plus(
          swapperAcc?.accumulatedGasUsedPSP || 0,
        );

        const totalStakeAmountPSP = swapperStake.toFixed(0); // @todo irrelevant?
        const refundPercent = getRefundPercent(totalStakeAmountPSP);

        assert(
          refundPercent,
          `Logic Error: failed to find refund percent for ${address}`,
        );

        let currRefundedAmountPSP = currGasFeePSP.multipliedBy(refundPercent);

        let currRefundedAmountUSD = currRefundedAmountPSP
          .multipliedBy(currencyRate.pspPrice)
          .dividedBy(10 ** 18); // psp decimals always encoded in 18decimals

        if (
          GRPSystemGuardian.totalRefundedAmountUSD(address)
            .plus(currRefundedAmountUSD)
            .isGreaterThan(MAX_USD_ADDRESS_BUDGET)
        ) {
          currRefundedAmountUSD = MAX_USD_ADDRESS_BUDGET.minus(
            GRPSystemGuardian.totalRefundedAmountUSD(address),
          );

          assert(
            currRefundedAmountUSD.isGreaterThanOrEqualTo(0),
            'Logic Error: quantity cannot be negative, this would mean we priorly refunded more than max',
          );

          currRefundedAmountPSP = currRefundedAmountUSD
            .dividedBy(currencyRate.pspPrice)
            .multipliedBy(10 ** 18);
        }

        GRPSystemGuardian.increaseTotalAmountRefundedUSDForAccount(
          address,
          currRefundedAmountUSD,
        );

        GRPSystemGuardian.increaseTotalPSPRefunded(currRefundedAmountPSP);

        const accRefundedAmountPSP = currRefundedAmountPSP.plus(
          swapperAcc?.refundedAmountPSP || 0,
        );

        const refundedAmountUSD = currRefundedAmountUSD.plus(
          swapperAcc?.refundedAmountUSD || 0,
        );

        const pendingGasRefundDatum: PendingEpochGasRefundData = {
          epoch,
          address,
          chainId,
          accumulatedGasUsedPSP: accumulatedGasUsedPSP.toFixed(0),
          accumulatedGasUsed: accumulatedGasUsed.toFixed(0),
          accumulatedGasUsedUSD: accumulatedGasUsedUSD.toFixed(0),
          accumulatedGasUsedChainCurrency:
            accumulatedGasUsedChainCurrency.toFixed(0),
          firstBlock: swapperAcc?.lastBlock || swap.blockNumber,
          lastBlock: swap.blockNumber,
          totalStakeAmountPSP,
          refundedAmountPSP: accRefundedAmountPSP.toFixed(0),
          refundedAmountUSD: refundedAmountUSD.toFixed(),
          firstTx: swapperAcc?.firstTx || swap.txHash,
          lastTx: swap.txHash,
          firstTimestamp: swapperAcc?.firstTimestamp || +swap.timestamp,
          lastTimestamp: +swap.timestamp,
          numTx: (swapperAcc?.numTx || 0) + 1,
          isCompleted: false,
        };

        accPendingGasRefundByAddress[address] = pendingGasRefundDatum;
        updatedPendingGasRefundDataByAddress[address] = pendingGasRefundDatum;
      }),
    );

    const updatedGasRefundDataList = Object.values(
      updatedPendingGasRefundDataByAddress,
    );

    if (updatedGasRefundDataList.length > 0) {
      logger.info(
        `updating ${updatedGasRefundDataList.length} pending gas refund data`,
      );
      await writePendingEpochData(updatedGasRefundDataList);
    }
  }

  logger.info(
    `computed gas refund for ${
      Object.keys(accPendingGasRefundByAddress).length
    } addresses`,
  );
}
