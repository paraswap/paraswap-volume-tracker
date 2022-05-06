import { assert } from 'ts-essentials';
import { BigNumber } from 'bignumber.js';
import {
  fetchVeryLastTimestampProcessed,
  writePendingEpochData
} from '../persistance/db-persistance';
import { getAllTXs } from './transaction-resolver'
import {
  GasRefundSafetyModuleStartEpoch,
  getRefundPercent,
  GRP_MIN_STAKE,
  GasRefundTransactionData
} from '../../../src/lib/gas-refund';
import { getPSPStakesHourlyWithinInterval } from '../staking';
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

  const veryLastTimestampProcessed = await fetchVeryLastTimestampProcessed({ chainId, epoch })

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
      `fetching swaps between ${_startTimestampSlice} and ${_endTimestampSlice}...`,
    );

    // alternatively can slice requests over different sub intervals matching different stakers subset but we'd be refetching same data
    const txs = await getAllTXs({
      epoch,
      startTimestamp: _startTimestampSlice,
      endTimestamp: _endTimestampSlice,
      chainId,
      epoch
    });

    logger.info(
      `fetched ${txs.length} txs between ${_startTimestampSlice} and ${_endTimestampSlice}`,
    );

    const pendingGasRefundTransactionData: GasRefundTransactionData[] = [];

    await Promise.all(
      txs.map(async swap => {
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

        const { txGasUsed } = swap

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

        const currGasUsed = new BigNumber(txGasUsed);

        const currGasUsedChainCur = currGasUsed.multipliedBy(
          swap.txGasPrice.toString(),
        ); // in wei

        const currGasUsedUSD = currGasUsedChainCur
          .multipliedBy(currencyRate.chainPrice)
          .dividedBy(10 ** 18); // chaincurrency always encoded in 18decimals

        const currGasFeePSP = currGasUsedChainCur.dividedBy(
          currencyRate.pspToChainCurRate,
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

        const pendingGasRefundDatum: GasRefundTransactionData = {
          epoch,
          address,
          chainId,
          hash: swap.txHash,
          block: swap.blockNumber,
          timestamp: +swap.timestamp,
          gasUsed: txGasUsed.toFixed(0),
          gasUsedChainCurrency: currGasUsedChainCur.toFixed(0),
          pspUsd: currencyRate.pspPrice,
          chainCurrencyUsd: currencyRate.chainPrice,
          pspChainCurrency: currencyRate.pspToChainCurRate,
          gasUsedUSD: currGasUsedUSD.toFixed(0),
          totalStakeAmountPSP,
          refundedAmountPSP: currRefundedAmountPSP.toFixed(0),
          refundedAmountUSD: currRefundedAmountUSD.toFixed(0)
        };

        pendingGasRefundTransactionData.push(pendingGasRefundDatum);
      })
    );

    if (pendingGasRefundTransactionData.length > 0) {
      logger.info(
        `updating ${pendingGasRefundTransactionData.length} pending gas refund data`,
      );
      await writePendingEpochData(pendingGasRefundTransactionData);
    }
  }
}
