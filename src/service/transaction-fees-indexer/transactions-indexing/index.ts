import { HistoricalPrice, TxFeesByAddress } from '../types';
import { computeAccumulatedTxFeesByAddressForSuccessfulSwapTxs } from './successful-swap-tx-indexing';

// @TODO: index more transactions (failed swap tx, staking tx)
export async function computeAccumulatedTxFeesByAddress({
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
  return computeAccumulatedTxFeesByAddressForSuccessfulSwapTxs({
    chainId,
    startTimestamp,
    endTimestamp,
    pspNativeCurrencyDailyRate,
    epoch,
  });
}
