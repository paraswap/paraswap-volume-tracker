import { assert } from 'ts-essentials';
import { BigNumber } from 'bignumber.js';
import {
  fetchVeryLastTimestampProcessed,
  writePendingEpochData
} from '../persistance/db-persistance';
import { getSuccessfulSwaps } from './swaps-subgraph';
import {
  GasRefundSafetyModuleStartEpoch,
  GasRefundTxOriginCheckStartEpoch,
  GasRefundDeduplicationStartEpoch,
  getRefundPercent,
  GasRefundTransactionData
} from '../../../src/lib/gas-refund';
import { getTransactionGasUsed } from '../staking/covalent';
import { getPSPStakesHourlyWithinInterval } from '../staking';
import * as _ from 'lodash';
import { ONE_HOUR_SEC, startOfHourSec } from '../utils';
import { PriceResolverFn } from '../token-pricing/psp-chaincurrency-pricing';
import GRPSystemGuardian, { MAX_USD_ADDRESS_BUDGET } from '../system-guardian';
import SafetyModuleStakesTracker from '../staking/safety-module-stakes-tracker';

// empirically set to maximise on processing time without penalising memory and fetching constraigns
// @FIXME: fix swaps subgraph pagination to always stay on safest spot
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
      `fetching stakers between ${_startTimestampSlice} and ${_endTimestampSlice}...`,
    );
    // over fetch stakes to allow for stakes resolving max(stakesStartOfHour, stakesEndOfHour)
    // @TEMP: should not overflow current date time -> will transition to fetching single stake per timestamp
    const stakesByHour = await getPSPStakesHourlyWithinInterval(
      _startTimestampSlice,
      Math.min(endTimestamp, _endTimestampSlice + ONE_HOUR_SEC),
    );

    assert(stakesByHour, 'stakesByHour should be defined');

    const stakersAddress = _.uniq(
      Object.values(stakesByHour).flatMap(stakesByAddress =>
        Object.keys(stakesByAddress || {}),
      ),
    );

    logger.info(
      `fetched ${stakersAddress.length} stakers in total between ${_startTimestampSlice} and ${_endTimestampSlice}`,
    );

    logger.info(
      `fetching swaps between ${_startTimestampSlice} and ${_endTimestampSlice}...`,
    );

    // alternatively can slice requests over different sub intervals matching different stakers subset but we'd be refetching same data
    const swaps = await getSuccessfulSwaps({
      startTimestamp: _startTimestampSlice,
      endTimestamp: _endTimestampSlice,
      chainId,
    });

    logger.info(
      `fetched ${swaps.length} swaps between ${_startTimestampSlice} and ${_endTimestampSlice}`,
    );

    const pendingGasRefundTransactionData: GasRefundTransactionData[] = [];
    // hash list to track if we've seen a tx already (just checks against timeslices, we assume tx duplicates have the same timestamp)
    let txsSeen: Record<string, boolean> = {}

    await Promise.all(
      swaps.map(async swap => {
        if (
          epoch >= GasRefundTxOriginCheckStartEpoch &&
          swap.initiator !== swap.txOrigin
        ) {
          return;
        }

        const { txHash, txOrigin: address } = swap;

        if (txsSeen[txHash] && epoch >= GasRefundDeduplicationStartEpoch) {
          return;
        } else {
          txsSeen[txHash] = true
        }

        const startOfHourUnixTms = startOfHourSec(+swap.timestamp);
        const startOfNextHourUnixTms = startOfHourSec(
          +swap.timestamp + ONE_HOUR_SEC,
        );

        const stakesStartOfHour = stakesByHour[startOfHourUnixTms];
        const stakesStartOfNextHour =
          stakesByHour[startOfNextHourUnixTms] || {};

        assert(
          stakesStartOfHour,
          'stakes at beginning of hour should be defined',
        );
        assert(
          stakesStartOfNextHour,
          'stakes at beginning of next hour should be defined',
        );

        const sPSPStake = BigNumber.max(
          stakesStartOfHour[address] || 0,
          stakesStartOfNextHour[address] || 0,
        );

        let swapperStake: BigNumber;

        if (epoch >= GasRefundSafetyModuleStartEpoch) {
          const safetyModuleStake =
            SafetyModuleStakesTracker.getInstance().computeStakedPSPBalance(
              address,
              +swap.timestamp,
            );

          swapperStake = sPSPStake.plus(safetyModuleStake);
        } else {
          swapperStake = sPSPStake;
        }

        if (swapperStake.isZero()) {
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
