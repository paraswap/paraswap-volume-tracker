import { assert } from 'ts-essentials';
import { HistoricalPrice, TxFeesByAddress } from '../types';
import { BigNumber } from 'bignumber.js';
import {
  fetchPendingGasRefundData,
  fetchPendingGasRefundDataCovalent,
  fetchVeryLastTimestampProcessed,
  writePendingEpochData,
} from '../persistance/db-persistance';
import { getSwapsForAccounts, getSwapsPerNetwork, CovalentSwap } from './swaps-subgraph';
import {
  getRefundPercent,
  PendingEpochGasRefundData,
} from '../../../src/lib/gas-refund';
import { getTransactionGasUsed } from '../staking/covalent';
import { getPSPStakesHourlyWithinInterval } from '../staking';
import * as _ from 'lodash';
import { constructSameDayPrice } from '../token-pricing/psp-chaincurrency-pricing';
import { ONE_HOUR_SEC, startOfHourSec } from '../utils';
import * as Test from './temp-seed'

// empirically set to maximise on processing time without penalising memory and fetching constraigns
// @FIXME: fix swaps subgraph pagination to always stay on safest spot
const SLICE_DURATION = 6 * ONE_HOUR_SEC;

export async function computeSuccessfulSwapsTxFeesRefund({
  chainId,
  startTimestamp,
  endTimestamp,
  pspNativeCurrencyDailyRate,
  epoch,
}: {
  chainId: number;
  startTimestamp: number;
  endTimestamp: number;
  pspNativeCurrencyDailyRate: HistoricalPrice;
  epoch: number;
}): Promise<void> {
  const logger = global.LOGGER(
    `GRP:TRANSACTION_FEES_INDEXING: epoch=${epoch}, chainId=${chainId}`,
  );

  const findSameDayPrice = constructSameDayPrice(pspNativeCurrencyDailyRate);

  logger.info(
    `swapTracker start indexing between ${startTimestamp} and ${endTimestamp}`,
  );

  // todo: remove `accPendingGasRefundByAddressCOVALENT` and `fetchPendingGasRefundDataCovalent({ chainId, epoch })` after testing/comparing data
  const [accPendingGasRefundByAddress, accPendingGasRefundByAddressCOVALENT, veryLastTimestampProcessed] =
    await Promise.all([
      fetchPendingGasRefundData({ chainId, epoch }),
      fetchPendingGasRefundDataCovalent({ chainId, epoch }),
      fetchVeryLastTimestampProcessed({ chainId, epoch }),
    ]);

  const _startTimestamp = Math.max(
    startTimestamp,
    veryLastTimestampProcessed + 1,
  );

  // get all txs for the epoch,
  // todo: reinstate this - reading from disk is just for testing
  // const covalentTXs = await getSwapsPerNetwork({
  //   startTimestamp: _startTimestamp,
  //   endTimestamp,
  //   chainId
  // })
  const covalentTXs = Test.readStoredCovalentTXs(chainId, epoch, startTimestamp, endTimestamp)

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
      `fetching stakers between ${_startTimestamp} and ${_endTimestampSlice}...`,
    );
    const stakesByHour = await getPSPStakesHourlyWithinInterval(
      _startTimestampSlice,
      _endTimestampSlice + ONE_HOUR_SEC, // over fetch stakes to allow for stakes resolving max(stakesStartOfHour, stakesEndOfHour)
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
    // todo: keep while comparing data - this will be replaced with covalent tx data
    const swaps = await getSwapsForAccounts({
      startTimestamp: _startTimestampSlice,
      endTimestamp: _endTimestampSlice,
      accounts: stakersAddress,
      chainId,
    });

    const txsOfStakers = covalentTXs.filter(({txOrigin}) => stakersAddress.includes(txOrigin))

    // we already got all covalent txs for the epoch in one go, so here filter by timestamp just to fit in with old code
    const filteredTXs = txsOfStakers.filter(tx => {
      const timestamp = +tx.timestamp
      return timestamp >= _startTimestampSlice && timestamp <= _endTimestampSlice
    })

    // todo: go through all transactions (lifting off gas used) and getting stakes at each time - eg `fetchStakesPerUser?`

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
    const updatedPendingGasRefundDataByAddressCOVALENT: TxFeesByAddress = {};

    swapsWithGasUsed.forEach(swap => {
      const address = swap.txOrigin;
      const startOfHourUnixTms = startOfHourSec(+swap.timestamp);
      const startOfNextHourUnixTms = startOfHourSec(
        +swap.timestamp + ONE_HOUR_SEC,
      );

      const stakesStartOfHour = stakesByHour[startOfHourUnixTms];
      const stakesStartOfNextHour = stakesByHour[startOfNextHourUnixTms];

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

      const pspRateSameDay = findSameDayPrice(+swap.timestamp);

      assert(
        pspRateSameDay,
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

      const currGasFeePSP = currGasUsedChainCur.dividedBy(pspRateSameDay);

      const accumulatedGasUsedPSP = currGasFeePSP.plus(
        swapperAcc?.accumulatedGasUsedPSP || 0,
      );

      const totalStakeAmountPSP = swapperStake.toFixed(0); // @todo irrelevant?
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
        firstTimestamp: swapperAcc?.firstTimestamp || +swap.timestamp,
        lastTimestamp: +swap.timestamp,
        numTx: (swapperAcc?.numTx || 0) + 1,
        isCompleted: false,
      };

      accPendingGasRefundByAddress[address] = pendingGasRefundDatum;
      updatedPendingGasRefundDataByAddress[address] = pendingGasRefundDatum;
    });

    // todo: swapover to this code once happy, replacing above `swapsWithGasUsed.forEach` block
    filteredTXs.forEach(covalentSwap => {
      const address = covalentSwap.txOrigin;
      const startOfHourUnixTms = startOfHourSec(+covalentSwap.timestamp);
      const startOfNextHourUnixTms = startOfHourSec(
        +covalentSwap.timestamp + ONE_HOUR_SEC,
      );

      const stakesStartOfHour = stakesByHour[startOfHourUnixTms];
      const stakesStartOfNextHour = stakesByHour[startOfNextHourUnixTms];

      assert(
        stakesStartOfHour,
        'stakes at beginning of hour should be defined',
      );
      assert(
        stakesStartOfNextHour,
        'stakes at beginning of next hour should be defined',
      );

      const swapperAcc = accPendingGasRefundByAddressCOVALENT[address];

      const swapperStake = BigNumber.max(
        stakesStartOfHour[address] || 0,
        stakesStartOfNextHour[address] || 0,
      );

      if (swapperStake.isZero()) {
        // as we fetcher swaps for all stakers all hourly splitted intervals we sometimes fell into this case
        logger.warn(`could not retrieve any stake for staker ${address}`);
        return;
      }

      const pspRateSameDay = findSameDayPrice(+covalentSwap.timestamp);

      assert(
        pspRateSameDay,
        `could not retrieve psp/chaincurrency same day rate for swap at ${covalentSwap.timestamp}`,
      );

      // different from before - now we use original gas price (as covalent is already correct opposed to graph)
      const currGasUsed = new BigNumber(+covalentSwap.txGasUsed);
      const accumulatedGasUsed = currGasUsed.plus(
        swapperAcc?.accumulatedGasUsed || 0,
      );

      const currGasUsedChainCur = currGasUsed.multipliedBy(
        +covalentSwap.txGasPrice,
      ); // in wei

      const accumulatedGasUsedChainCurrency = currGasUsedChainCur.plus(
        swapperAcc?.accumulatedGasUsedChainCurrency || 0,
      );

      const currGasFeePSP = currGasUsedChainCur.dividedBy(pspRateSameDay);

      const accumulatedGasUsedPSP = currGasFeePSP.plus(
        swapperAcc?.accumulatedGasUsedPSP || 0,
      );

      const totalStakeAmountPSP = swapperStake.toFixed(0); // @todo irrelevant?
      const refundPercent = getRefundPercent(totalStakeAmountPSP);
      assert(
        refundPercent,
        `Logic Error: failed to find refund percent for ${address}`,
      );
      const currRefundedAmountPSP = currGasFeePSP.multipliedBy(refundPercent);

      const accRefundedAmountPSP = currRefundedAmountPSP.plus(
        swapperAcc?.refundedAmountPSP || 0,
      );

      const pendingGasRefundDatumCOVALENT: PendingEpochGasRefundData = {
        epoch,
        address,
        chainId,
        accumulatedGasUsedPSP: accumulatedGasUsedPSP.toFixed(0),
        accumulatedGasUsed: accumulatedGasUsed.toFixed(0),
        accumulatedGasUsedChainCurrency:
          accumulatedGasUsedChainCurrency.toFixed(0),
        firstBlock: swapperAcc?.lastBlock || covalentSwap.blockNumber,
        lastBlock: covalentSwap.blockNumber,
        totalStakeAmountPSP,
        refundedAmountPSP: accRefundedAmountPSP.toFixed(0),
        firstTx: swapperAcc?.firstTx || covalentSwap.txHash,
        lastTx: covalentSwap.txHash,
        firstTimestamp: swapperAcc?.firstTimestamp || +covalentSwap.timestamp,
        lastTimestamp: +covalentSwap.timestamp,
        numTx: (swapperAcc?.numTx || 0) + 1,
        isCompleted: false,
      };

      accPendingGasRefundByAddressCOVALENT[address] = pendingGasRefundDatumCOVALENT;
      updatedPendingGasRefundDataByAddressCOVALENT[address] = pendingGasRefundDatumCOVALENT;
    });

    const updatedGasRefundDataList = Object.values(
      updatedPendingGasRefundDataByAddress,
    );
    const updatedGasRefundDataListCOVALENT = Object.values(
      updatedPendingGasRefundDataByAddressCOVALENT,
    );

    if (updatedGasRefundDataList.length > 0) {
      logger.info(
        `updating ${updatedGasRefundDataList.length} pending gas refund data`,
      );
      await writePendingEpochData(updatedGasRefundDataList, []);
    }

    if (updatedGasRefundDataList.length > 0) {
      logger.info(
        `updating ${updatedGasRefundDataList.length} pending gas refund data`,
      );
      await writePendingEpochData([], updatedGasRefundDataListCOVALENT);
    }
  }

  logger.info(
    `computed gas refund for ${
      Object.keys(accPendingGasRefundByAddress).length
    } addresses`,
  );
}
