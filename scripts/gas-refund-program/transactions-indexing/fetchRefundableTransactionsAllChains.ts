import { assert } from 'ts-essentials';
import { forceEthereumMainnet } from '../../../src/lib/config';
import {
  getCurrentEpoch,
  resolveEpochCalcTimeInterval,
} from '../../../src/lib/epoch-helpers';
import {
  GasRefundGenesisEpoch,
  GRP_SUPPORTED_CHAINS,
} from '../../../src/lib/gas-refund';

import {
  getLatestEpochRefunded,
  merkleRootExists,
} from '../persistance/db-persistance';
import { fetchPricingAndTransactions } from './fetchPricingAndTransactions';

const logger = global.LOGGER('GRP::fetchRefundableTransactionsAllChains');

export async function fetchRefundableTransactionsAllChains() {
  return Promise.all(
    GRP_SUPPORTED_CHAINS.map(async chainId => {
      const lastEpochRefunded = await getLatestEpochRefunded(
        forceEthereumMainnet(chainId),
      );

      const startEpoch = lastEpochRefunded
        ? lastEpochRefunded + 1
        : GasRefundGenesisEpoch;

      assert(
        startEpoch >= GasRefundGenesisEpoch,
        'cannot compute refund data for epoch < genesis_epoch',
      );

      for (let epoch = startEpoch; epoch <= getCurrentEpoch(); epoch++) {
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
