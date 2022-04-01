import { assert } from 'ts-essentials';
import { BlockInfo } from '../../../src/lib/block-info';
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

const PARTITION_SIZE = 1000; // depends on thegraph capacity and memory

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
        const accGasUsed = currGasUsed.plus(
          swapperAcc?.accumulatedGasUsed || 0,
        );

        const currGasUsedChainCur = currGasUsed.multipliedBy(
          swap.txGasPrice.toString(),
        ); // in wei

        const accGasUsedChainCur = currGasUsedChainCur.plus(
          swapperAcc?.accumulatedGasUsedChainCurrency || 0,
        );

        const currGasFeePSP = currGasUsedChainCur.dividedBy(pspRateSameDay);

        const accGasFeePSP = currGasFeePSP.plus(
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
          chainId: chainId,
          accumulatedGasUsedPSP: accGasFeePSP.toFixed(0),
          accumulatedGasUsed: accGasUsed.toFixed(0),
          accumulatedGasUsedChainCurrency: accGasUsedChainCur.toFixed(0),
          lastBlockNum: swap.blockNumber,
          isCompleted: false,
          totalStakeAmountPSP,
          refundedAmountPSP: accRefundedAmountPSP.toFixed(0),
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
