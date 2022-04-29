import { assert } from 'ts-essentials';
import { BigNumber } from 'bignumber.js';
import {
  fetchVeryLastTimestampProcessed,
  writePendingEpochData,
  fetchTransactionOccurences
} from '../persistance/db-persistance';
import { getSwapsForAccounts } from './swaps-subgraph';
import {
  getRefundPercent,
  GasRefundTransactionData,
  GasRefundDeduplicationStartEpoch
} from '../../../src/lib/gas-refund';
import { getTransactionGasUsed } from '../staking/covalent';
import { getPSPStakesHourlyWithinInterval } from '../staking';
import * as _ from 'lodash';
import { ONE_HOUR_SEC, startOfHourSec } from '../utils';
import { PriceResolverFn } from '../token-pricing/psp-chaincurrency-pricing';
import GRPSystemGuardian, { MAX_USD_ADDRESS_BUDGET } from '../system-guardian';

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

  // load all past txs into memory as a record to track dupes
  const pastTXs: Record<string, number> = await fetchTransactionOccurences(epoch, chainId)

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

    if (!stakersAddress || !stakersAddress.length) {
      logger.warn(
        `no stakers found between ${_startTimestampSlice} and ${_endTimestampSlice}...`,
      );
      continue;
    }

    logger.info(
      `fetched ${stakersAddress.length} stakers in total between ${_startTimestampSlice} and ${_endTimestampSlice}`,
    );

    logger.info(
      `fetching swaps between ${_startTimestampSlice} and ${_endTimestampSlice}...`,
    );

    // alternatively can slice requests over different sub intervals matching different stakers subset but we'd be refetching same data
    const swaps = await getSwapsForAccounts({
      startTimestamp: _startTimestampSlice,
      endTimestamp: _endTimestampSlice,
      accounts: stakersAddress,
      chainId,
    });

    logger.info(
      `fetched ${swaps.length} swaps between ${_startTimestampSlice} and ${_endTimestampSlice}`,
    );

    logger.info(
      `fetching gas used between ${_startTimestampSlice} and ${_endTimestampSlice}...`,
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

    logger.info(
      `fetched gas used between ${_startTimestampSlice} and ${_endTimestampSlice}`,
    );

    const pendingGasRefundTransactionData: GasRefundTransactionData[] = [];

    swapsWithGasUsed.forEach(swap => {
      if (GRPSystemGuardian.isMaxPSPGlobalBudgetSpent()) {
        logger.warn(
          `max psp global budget spent, preventing further processing & storing`,
        );
        return;
      }

      const address = swap.txOrigin;

      if (GRPSystemGuardian.isAccountUSDBudgetSpent(address)) {
        logger.warn(`Max budget already spent for ${address}`);
        return;
      }

      const startOfHourUnixTms = startOfHourSec(+swap.timestamp);
      const startOfNextHourUnixTms = startOfHourSec(
        +swap.timestamp + ONE_HOUR_SEC,
      );

      const stakesStartOfHour = stakesByHour[startOfHourUnixTms];
      const stakesStartOfNextHour = stakesByHour[startOfNextHourUnixTms] || {};

      assert(
        stakesStartOfHour,
        'stakes at beginning of hour should be defined',
      );
      assert(
        stakesStartOfNextHour,
        'stakes at beginning of next hour should be defined',
      );

      const swapperStake = BigNumber.max(
        stakesStartOfHour[address] || 0,
        stakesStartOfNextHour[address] || 0,
      );

      if (swapperStake.isZero()) {
        // as we fetcher swaps for all stakers all hourly splitted intervals we sometimes fell into this case
        logger.warn(`could not retrieve any stake for staker ${address}`);
        return;
      }

      const currencyRate = resolvePrice(+swap.timestamp);

      assert(
        currencyRate,
        `could not retrieve psp/chaincurrency same day rate for swap at ${swap.timestamp}`,
      );

      const currGasUsed = new BigNumber(swap.txGasUsed);

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

      // increment occurences count (to guard against edge edge case with multiple swaps per tx)
      pastTXs[swap.txHash] = pastTXs[swap.txHash] ? pastTXs[swap.txHash] + 1 : 1
      const occurence = pastTXs[swap.txHash]

      const pendingGasRefundDatum: GasRefundTransactionData = {
        epoch,
        address,
        chainId,
        hash: swap.txHash,
        block: swap.blockNumber,
        timestamp: +swap.timestamp,
        gasUsed: swap.txGasUsed.toFixed(0),
        gasUsedChainCurrency: currGasUsedChainCur.toFixed(0),
        gasUsedPSP: currGasFeePSP.toFixed(0),
        gasUsedUSD: currGasUsedUSD.toFixed(0),
        totalStakeAmountPSP,
        refundedAmountPSP: currRefundedAmountPSP.toFixed(0),
        refundedAmountUSD: currRefundedAmountUSD.toFixed(0),
        occurence
      };

      pendingGasRefundTransactionData.push(pendingGasRefundDatum);
    });


    if (pendingGasRefundTransactionData.length > 0) {
      logger.info(
        `updating ${pendingGasRefundTransactionData.length} pending gas refund data`,
      );
      await writePendingEpochData(pendingGasRefundTransactionData);
    }
  }

  // removed this as a mindless optimisation, could stay in ultimately
  // const totalAddressesAlreadyProcessedThisEpoch = await fetchEpochAddressesProcessedCount({ chainId, epoch })

  // logger.info(
  //   `On chain ${chainId}, a gas refund has been computed for ${totalAddressesAlreadyProcessedThisEpoch} addresses.`,
  // );
}
