import { assert } from 'ts-essentials';
import {
  getCurrentEpoch,
  resolveEpochCalcTimeInterval,
} from '../../../src/lib/gas-refund/epoch-helpers';
import {
  GasRefundGenesisEpoch,
  GasRefundV2EpochOptimismFlip,
  GasRefundV2PIP55,
  GRP_SUPPORTED_CHAINS,
} from '../../../src/lib/gas-refund/gas-refund';

import {
  loadLastEthereumDistributionFromDb,
  getLatestEpochRefunded,
  merkleRootExists,
} from '../persistance/db-persistance';
import { fetchPricingAndTransactions } from './fetchPricingAndTransactions';
import {
  CHAIN_ID_MAINNET,
  CHAIN_ID_OPTIMISM,
  ETH_NETWORKS,
} from '../../../src/lib/constants';
import { forceEthereumMainnet } from '../../../src/lib/gas-refund/config';

const logger = global.LOGGER('GRP::fetchRefundableTransactionsAllChains');

export async function fetchRefundableTransactionsAllChains() {
  const lastEthereumDistribution = await loadLastEthereumDistributionFromDb();

  const GrpChainsToIterateOver =
    lastEthereumDistribution && lastEthereumDistribution >= GasRefundV2PIP55 - 1
      ? [CHAIN_ID_MAINNET]
      : GRP_SUPPORTED_CHAINS;
  return Promise.all(
    GrpChainsToIterateOver.map(async chainId => {
      const _lastEpochRefunded =
        lastEthereumDistribution ??
        (await getLatestEpochRefunded(
          ETH_NETWORKS.includes(chainId)
            ? forceEthereumMainnet(chainId)
            : chainId,
        ));

      const lastEpochRefunded =
        chainId !== CHAIN_ID_OPTIMISM
          ? _lastEpochRefunded
          : _lastEpochRefunded || GasRefundV2EpochOptimismFlip - 1;

      const startEpoch = lastEpochRefunded
        ? lastEpochRefunded + 1
        : GasRefundGenesisEpoch;

      assert(
        startEpoch >= GasRefundGenesisEpoch,
        'cannot compute refund data for epoch < genesis_epoch',
      );

      // TODO: NB: artificially add +1 to startEpoch so that tracker can be tested since fresh epoch
      for (let epoch = startEpoch + 1; epoch <= getCurrentEpoch(); epoch++) {
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
