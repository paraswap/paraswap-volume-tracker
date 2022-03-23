import { SwapsTracker } from '../../lib/swaps-tracker';
import { HistoricalPrice, TxFeesByAddress } from './types';

export async function computeAccumulatedTxFeesByAddress({
  chainId,
  startTimestamp, // @TODO
  endTimestamp, // @TODO
  pspNativeCurrencyDailyRate,
}: {
  chainId: number;
  startTimestamp: number;
  endTimestamp: number;
  pspNativeCurrencyDailyRate: HistoricalPrice;
}) {
  const swapTracker = SwapsTracker.getInstance(chainId);
  const startBlock = 14440939; // @TODO: read from BlockInfo
  const endBlock = 14441538; // @TODO: read from BlockInfo

  /** @TODO: partitioning (startBlock,endBlock) in k (what's best value for k ? 100 ? 1000 ?)
   * compute accumulated tx fees for address accross each partion
   * clean indexedSwaps at end of partition processing
   */
  await swapTracker.indexSwaps(startBlock, endBlock);

  const swapsByBlock = swapTracker.indexedSwaps;

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

  return accumulatedTxFeesByAddress;
}
