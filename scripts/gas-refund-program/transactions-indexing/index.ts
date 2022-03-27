import { HistoricalPrice, StakedPSPByAddress, TxFeesByAddress } from '../types';
import { computeAccumulatedTxFeesByAddressForSuccessfulSwapTxs } from './successful-swap-tx-indexing';

// @TODO: index more transactions (failed swap tx, staking tx)
export async function computeAccumulatedTxFeesByAddress({
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
  return computeAccumulatedTxFeesByAddressForSuccessfulSwapTxs({
    chainId,
    startTimestamp,
    endTimestamp,
    pspNativeCurrencyDailyRate,
    epoch,
    stakes,
  });
}
