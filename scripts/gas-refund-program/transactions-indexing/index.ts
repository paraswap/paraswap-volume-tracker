import { GRPSystemStateGuard } from '../system-guardian';
import {
  constructSameDayPrice,
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
  systemGuardian,
}: {
  chainId: number;
  startTimestamp: number;
  endTimestamp: number;
  epoch: number;
  systemGuardian: GRPSystemStateGuard;
}) {
  // retrieve daily psp/native currency rate for (startCalcTime, endCalcTime)
  logger.info(
    `start fetching daily psp/native currency rate for chainId=${chainId}`,
  );
  const pspNativeCurrencyDailyRate = await fetchDailyPSPChainCurrencyRate({
    chainId,
    startTimestamp,
    endTimestamp,
  });

  const findSameDayPrice = constructSameDayPrice(pspNativeCurrencyDailyRate);

  // retrieve all tx beetween (start_epoch_timestamp, end_epoch_timestamp) +  compute progressively mapping(chainId => address => mapping(timestamp => accGasUsedPSP)) // address: txOrigin, timestamp: start of the day
  logger.info(
    `start indexing transaction and accumulate tx fees and refund for chainId=${chainId}`,
  );

  await computeGasRefundSuccessSwaps({
    chainId,
    startTimestamp,
    endTimestamp,
    epoch,
    systemGuardian,
    findSameDayPrice,
  });
}
