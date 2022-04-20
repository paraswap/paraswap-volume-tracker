import { assert } from 'ts-essentials';
import { TxFeesByAddress } from '../types';
import { BigNumber } from 'bignumber.js';
import {
  fetchPendingGasRefundData,
  fetchVeryLastTimestampProcessed,
  writePendingEpochData,
} from '../persistance/db-persistance';
import { getSwapsForAccounts } from './swaps-subgraph';
import {
  getRefundPercent,
  PendingEpochGasRefundData,
} from '../../../src/lib/gas-refund';
import { getTransactionGasUsed } from '../staking/covalent';
import { getPSPStakesHourlyWithinInterval } from '../staking';
import * as _ from 'lodash';
import { ONE_HOUR_SEC, startOfHourSec } from '../utils';
import { FindSameDayPrice } from '../token-pricing/psp-chaincurrency-pricing';
import GRPSystemGuardian, { MAX_USD_ADDRESS_BUDGET } from '../system-guardian';

// empirically set to maximise on processing time without penalising memory and fetching constraigns
// @FIXME: fix swaps subgraph pagination to always stay on safest spot
const SLICE_DURATION = 6 * ONE_HOUR_SEC;

export async function computeSuccessfulSwapsTxFeesRefund({
  chainId,
  startTimestamp,
  endTimestamp,
  epoch,
  findSameDayPrice,
}: {
  chainId: number;
  startTimestamp: number;
  endTimestamp: number;
  epoch: number;
  findSameDayPrice: FindSameDayPrice;
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

    const updatedPendingGasRefundDataByAddress: TxFeesByAddress = {};

    swapsWithGasUsed.forEach(swap => {
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

      const swapperAcc = accPendingGasRefundByAddress[address];

      const swapperStake = BigNumber.max(
        stakesStartOfHour[address] || 0,
        stakesStartOfNextHour[address] || 0,
      );

      if (swapperStake.isZero()) {
        // as we fetcher swaps for all stakers all hourly splitted intervals we sometimes fell into this case
        logger.warn(`could not retrieve any stake for staker ${address}`);
        return;
      }

      const currencyRate = findSameDayPrice(+swap.timestamp);

      assert(
        currencyRate,
        `could not retrieve psp/chaincurrency same day rate for swap at ${swap.timestamp}`,
      );

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
          .isGreaterThanOrEqualTo(MAX_USD_ADDRESS_BUDGET)
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
    });

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
