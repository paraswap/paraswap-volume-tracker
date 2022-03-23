import { assert } from 'ts-essentials';
import { BlockInfo } from '../../lib/block-info';
import { SwapsTracker } from '../../lib/swaps-tracker';
import { HistoricalPrice, TxFeesByAddress } from './types';

const logger = global.LOGGER('GRP');

export async function computeAccumulatedTxFeesByAddress({
  chainId,
  startTimestamp,
  endTimestamp,
  pspNativeCurrencyDailyRate,
}: {
  chainId: number;
  startTimestamp: number;
  endTimestamp: number;
  pspNativeCurrencyDailyRate: HistoricalPrice;
}) {
  const swapTracker = SwapsTracker.getInstance(chainId, true);
  const blockInfo = BlockInfo.getInstance(chainId);
  const [startBlock, endBlock] = await Promise.all([
    blockInfo.getBlockAfterTimeStamp(startTimestamp),
    blockInfo.getBlockAfterTimeStamp(endTimestamp),
  ]);

  assert(
    startBlock,
    `no start block found for chain ${chainId} for timestamp ${startTimestamp}`,
  );
  assert(
    endBlock,
    `no start block found for chain ${chainId} for timestamp ${endTimestamp}`,
  );

  /** @TODO: partitioning (startBlock,endBlock) in k (what's best value for k ? 100 ? 1000 ?)
   * compute accumulated tx fees for address accross each partion
   * clean indexedSwaps at end of partition processing
   */
  logger.info(
    `swapTracker start indexing between ${startBlock} and ${endBlock}`,
  );
  await swapTracker.indexSwaps(startBlock, endBlock);

  const swapsByBlock = swapTracker.indexedSwaps;

  logger.info(`swapTracker indexed ${Object.keys(swapsByBlock).length} blocks`);

  const accumulatedTxFeesByAddress = Object.entries(
    swapsByBlock,
  ).reduce<TxFeesByAddress>((acc, [, swapsInBlock]) => {
    swapsInBlock.forEach(swap => {
      const swapperAcc = acc[swap.txOrigin];

      const pspRateSameDay = pspNativeCurrencyDailyRate.find(
        p => swap.timestamp > p.timestamp,
      ); // @FIXME: likely not correct, suboptimal

      if (!pspRateSameDay) throw new Error('Fail to find price for same day');

      const currGasFeePSP =
        swap.txGasUsed * swap.txGasPrice * BigInt(pspRateSameDay.rate);

      const accGasFeePSP =
        (swapperAcc?.accGasFeePSP || BigInt(0)) + currGasFeePSP;

      acc[swap.txOrigin] = {
        accGasFeePSP,
      };
    });

    return acc;
  }, {});

  logger.info(
    `computed accumulated tx fees for ${
      Object.keys(accumulatedTxFeesByAddress).length
    } addresses`,
  );

  return accumulatedTxFeesByAddress;
}
