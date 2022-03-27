import { assert } from 'ts-essentials';
import { BlockInfo } from '../../../lib/block-info';
import {
  HistoricalPrice,
  TxFeesByAddress,
  PendingEpochGasRefundData,
  StakedPSPByAddress,
} from '../types';
import { BigNumber } from 'bignumber.js';
import { constructSameDayPrice } from '../psp-chaincurrency-pricing';
import {
  readPendingEpochData,
  writePendingEpochData,
} from '../persistance/db-persistance';
import { getSwapsForAccounts } from './swaps-subgraph';

const logger = global.LOGGER('GRP:TRANSACTION_FEES_INDEXING');

const PARTITION_SIZE = 100; // depends on thegraph capacity and memory

export async function computeAccumulatedTxFeesByAddressForSuccessfulSwapTxs({
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
}): Promise<TxFeesByAddress> {
  const blockInfo = BlockInfo.getInstance(chainId);
  const [epochStartBlock, epochEndBlock] = await Promise.all([
    blockInfo.getBlockAfterTimeStamp(startTimestamp),
    blockInfo.getBlockAfterTimeStamp(endTimestamp),
  ]);
  const findSameDayPrice = constructSameDayPrice(pspNativeCurrencyDailyRate);
  const stakersAddress = Object.keys(stakes);

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
      `start indexing partition between ${_startBlock} and ${_endBlock}`,
    );

    const swaps = await getSwapsForAccounts({
      startBlock: _startBlock,
      endBlock: _endBlock,
      accounts: stakersAddress,
      chainId,
    });

    logger.info(
      `fetched ${swaps.length} swaps withing startBlock ${_startBlock} and endBlock ${_endBlock}`,
    );

    accumulatedTxFeesByAddress = swaps.reduce<TxFeesByAddress>((acc, swap) => {
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

      // @TODO: shoot bignumber overhead
      const currGasUsed = new BigNumber(swap.txGasUsed.toString());
      const accGasUsed = currGasUsed.plus(swapperAcc?.accumulatedGasUsed || 0);

      const currGasFeePSP = currGasUsed
        .multipliedBy(swap.txGasPrice.toString()) // in gwei
        .multipliedBy(1e9) //  convert to wei
        .multipliedBy(pspRateSameDay);

      const accGasFeePSP = currGasFeePSP.plus(
        swapperAcc?.accumulatedGasUsedPSP || 0,
      );

      const pendingGasRefundDatum: PendingEpochGasRefundData = {
        epoch,
        address,
        chainId: chainId,
        accumulatedGasUsedPSP: accGasFeePSP.toFixed(0),
        accumulatedGasUsed: accGasUsed.toFixed(0),
        lastBlockNum: swap.blockNumber,
        isCompleted: false,
        totalStakeAmountPSP: stakes[address],
      };

      acc[address] = pendingGasRefundDatum;

      return acc;
    }, accumulatedTxFeesByAddress);

    const values = Object.values(accumulatedTxFeesByAddress);
    if (values.length > 0) {
      await writePendingEpochData(values);
    }
  }

  logger.info(
    `computed accumulated tx fees for ${
      Object.keys(accumulatedTxFeesByAddress).length
    } addresses`,
  );

  return accumulatedTxFeesByAddress;
}
