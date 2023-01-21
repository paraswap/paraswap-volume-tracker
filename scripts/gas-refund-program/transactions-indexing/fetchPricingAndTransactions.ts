import { GasRefundPricingAlgoFlipEpoch } from '../../../src/lib/gas-refund';
import { forceEthereumMainnet } from '../config';
import {
  constructPriceResolver,
  fetchDailyPSPChainCurrencyRate,
} from '../token-pricing/psp-chaincurrency-pricing';
import { fetchRefundableTransactions } from './fetchRefundableTransactions';

const logger = global.LOGGER('GRP:fetchRefundableTransactionsForChain');

export async function fetchPricingAndTransactions({
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
    chainId: forceEthereumMainnet(chainId), // no pricing for tokens on testnet
    startTimestamp:
      epoch < GasRefundPricingAlgoFlipEpoch
        ? startTimestamp
        : startTimestamp - 48 * 60 * 60, // overfetch to allow for last 24h avg
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

  await fetchRefundableTransactions({
    chainId,
    startTimestamp,
    endTimestamp,
    epoch,
    resolvePrice,
  });
}
