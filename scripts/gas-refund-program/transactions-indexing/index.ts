import { GasRefundPricingAlgoFlipEpoch } from '../../../src/lib/gas-refund';
import {
  constructPriceResolver,
  fetchDailyPSPChainCurrencyRate,
} from '../token-pricing/psp-chaincurrency-pricing';
import { computeSuccessfulSwapsTxFeesRefund as computeGasRefundSuccessSwaps } from './successful-swap-tx-indexing';

const logger = global.LOGGER('GRP:computeGasRefundAllTxs');

// @TODO: index more transactions (failed swap tx, staking tx)
export async function computeGasRefundAllTxs({
  chainId,
  startTimestamp,
  endTimestamp,
  epoch,
}: {
  chainId: number;
  startTimestamp: number;
  endTimestamp: number;
  epoch: number;
}) {
  // retrieve daily psp/native currency rate for (startCalcTime, endCalcTime)
  logger.info(
    `start fetching daily psp/native currency rate for chainId=${chainId}`,
  );
  const pspNativeCurrencyDailyRate = await fetchDailyPSPChainCurrencyRate({
    chainId,
    startTimestamp:
      epoch < GasRefundPricingAlgoFlipEpoch
        ? startTimestamp
        : startTimestamp - 24 * 60 * 60, // overfetch to allow for last 24h avg
    endTimestamp,
  });

  const resolvePrice = constructPriceResolver(
    pspNativeCurrencyDailyRate,
    epoch < GasRefundPricingAlgoFlipEpoch ? 'sameDay' : 'last24h', // for backward compatibility
  );

  // retrieve all tx beetween (start_epoch_timestamp, end_epoch_timestamp) +  compute progressively mapping(chainId => address => mapping(timestamp => accGasUsedPSP)) // address: txOrigin, timestamp: start of the day
  logger.info(
    `start indexing transaction and accumulate tx fees and refund for chainId=${chainId}`,
  );

  await computeGasRefundSuccessSwaps({
    chainId,
    startTimestamp,
    endTimestamp,
    epoch,
    resolvePrice,
  });
}
