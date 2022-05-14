import { assert } from 'ts-essentials';
import { CHAIN_ID_MAINNET } from '../../../src/lib/constants';
import { EpochInfo } from '../../../src/lib/epoch-info';
import {
  GasRefundGenesisEpoch,
  GRP_SUPPORTED_CHAINS,
} from '../../../src/lib/gas-refund';
import { resolveEpochCalcTimeInterval } from '../common';
import {
  getLatestEpochProcessed,
  merkleRootExists,
} from '../persistance/db-persistance';
import { fetchPricingAndTransactions } from './fetchPricingAndTransactions';

const logger = global.LOGGER('GRP::fetchRefundableTransactionsAllChains');

export async function fetchRefundableTransactionsAllChains() {
  const epochInfo = EpochInfo.getInstance(CHAIN_ID_MAINNET, true);

  return Promise.all(
    GRP_SUPPORTED_CHAINS.map(async chainId => {
      const lastEpochProcessed = await getLatestEpochProcessed(chainId);

      const startEpoch = lastEpochProcessed || GasRefundGenesisEpoch;

      assert(
        startEpoch >= GasRefundGenesisEpoch,
        'cannot compute refund data for epoch < genesis_epoch',
      );

      for (
        let epoch = startEpoch;
        epoch <= epochInfo.getCurrentEpoch();
        epoch++
      ) {
        const { startCalcTime, endCalcTime } =
          await resolveEpochCalcTimeInterval(epoch);

        assert(startCalcTime, `could not resolve ${epoch}th epoch start time`);
        assert(endCalcTime, `could not resolve ${epoch}th epoch end time`);

        if (await merkleRootExists({ chainId, epoch })) {
          logger.info(
            `merkle root for chainId=${chainId} epoch=${epoch} already exists, SKIP`,
          );
          continue;
        }

        await fetchPricingAndTransactions({
          chainId,
          epoch,
          startTimestamp: startCalcTime,
          endTimestamp: endCalcTime,
        });
      }
    }),
  );
}
