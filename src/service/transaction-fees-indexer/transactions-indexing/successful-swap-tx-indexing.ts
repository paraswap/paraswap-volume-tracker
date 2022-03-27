import { assert } from 'ts-essentials';
import { BlockInfo } from '../../../lib/block-info';
import { SwapsTracker } from '../../../lib/swaps-tracker';
import {
  HistoricalPrice,
  TxFeesByAddress,
  PendingEpochGasRefundData,
} from '../types';
import { BigNumber } from 'bignumber.js';
import { constructSameDayPrice } from '../psp-chaincurrency-pricing';
import {
  readPendingEpochData,
  writePendingEpochData,
} from '../persistance/db-persistance';

const logger = global.LOGGER('GRP:TRANSACTION_FEES_INDEXING');

const PARTITION_SIZE = 100; // depends on thegraph capacity and memory

export async function computeAccumulatedTxFeesByAddressForSuccessfulSwapTxs({
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
}): Promise<TxFeesByAddress> {
  const swapTracker = SwapsTracker.getInstance(chainId, true);
  const blockInfo = BlockInfo.getInstance(chainId);
  const [epochStartBlock, epochEndBlock] = await Promise.all([
    blockInfo.getBlockAfterTimeStamp(startTimestamp),
    blockInfo.getBlockAfterTimeStamp(endTimestamp),
  ]);
  const findSameDayPrice = constructSameDayPrice(pspNativeCurrencyDailyRate);

  assert(
    epochStartBlock,
    `no start block found for chain ${chainId} for timestamp ${startTimestamp}`,
  );
  assert(
    epochEndBlock,
    `no start block found for chain ${chainId} for timestamp ${endTimestamp}`,
  );

  logger.info(
    `swapTracker start indexing between ${epochStartBlock} and ${epochEndBlock}`,
  );

  let [accumulatedTxFeesByAddress, veryLastBlockNumProcessed] =
    await readPendingEpochData({
      chainId,
      epoch,
    });

  const startBlock = Math.max(epochStartBlock, veryLastBlockNumProcessed + 1);

  logger.info(`start processing at block ${startBlock}`);

  for (
    let _startBlock = startBlock;
    _startBlock < epochEndBlock;
    _startBlock += PARTITION_SIZE
  ) {
    const _endBlock = Math.min(_startBlock + PARTITION_SIZE, epochEndBlock);

    logger.info(
      `swapTracker start indexing partition between ${_startBlock} and ${_endBlock}`,
    );

    await swapTracker.indexSwaps(_startBlock, _endBlock);

    const swapsByBlock = swapTracker.indexedSwaps;

    logger.info(
      `swapTracker indexed ${Object.keys(swapsByBlock).length} blocks`,
    );

    accumulatedTxFeesByAddress = Object.entries(
      swapsByBlock,
    ).reduce<TxFeesByAddress>((acc, [, swapsInBlock]) => {
      swapsInBlock.forEach(swap => {
        const swapperAcc = acc[swap.txOrigin];

        const pspRateSameDay = findSameDayPrice(swap.timestamp);

        if (!pspRateSameDay) {
          logger.warn(
            `Fail to find price for same day ${
              swap.timestamp
            } and rates=${JSON.stringify(
              pspNativeCurrencyDailyRate.flatMap(p => p.timestamp),
            )}`,
          );

          return;
        }

        // @TODO: shoot bignumber overhead
        const currGasUsed = new BigNumber(swap.txGasUsed.toString());
        const accGasUsed = currGasUsed.plus(
          swapperAcc?.accumulatedGasUsed || 0,
        );

        const currGasFeePSP = currGasUsed
          .multipliedBy(swap.txGasPrice.toString()) // in gwei
          .multipliedBy(1e9) //  convert to wei
          .multipliedBy(pspRateSameDay);

        const accGasFeePSP = currGasFeePSP.plus(
          swapperAcc?.accumulatedGasUsedPSP || 0,
          //@TODO: debug data (acc gas used, avg gas price)
        );

        const pendingGasRefundDatum: PendingEpochGasRefundData = {
          // @fixme remove initailEpochData to use acc
          epoch,
          address: swap.txOrigin,
          chainId: chainId,
          accumulatedGasUsedPSP: accGasFeePSP.toFixed(0),
          accumulatedGasUsed: accGasUsed.toFixed(0),
          lastBlockNum: swap.blockNumber,
          isCompleted: false,
        };

        acc[swap.txOrigin] = pendingGasRefundDatum;
      });

      return acc;
    }, accumulatedTxFeesByAddress);

    await writePendingEpochData(Object.values(accumulatedTxFeesByAddress));

    swapTracker.indexedSwaps = {}; // cleaning step
  }

  logger.info(
    `computed accumulated tx fees for ${
      Object.keys(accumulatedTxFeesByAddress).length
    } addresses`,
  );

  return accumulatedTxFeesByAddress;
}
