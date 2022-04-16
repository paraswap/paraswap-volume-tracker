import '../../src/lib/log4js';
import * as dotenv from 'dotenv';
dotenv.config();
import { computeGasRefundAllTxs } from './transactions-indexing';
import { merkleRootExists } from './persistance/db-persistance';

import { assert } from 'ts-essentials';
import {
  GasRefundGenesisEpoch,
  GRP_SUPPORTED_CHAINS,
} from '../../src/lib/gas-refund';
import { GasRefundParticipation } from '../../src/models/GasRefundParticipation';
import { init, resolveEpochCalcTimeInterval } from './common';
import { EpochInfo } from '../../src/lib/epoch-info';
import { CHAIN_ID_MAINNET } from '../../src/lib/constants';
import Database from '../../src/database';

const logger = global.LOGGER('GRP');

async function startComputingGasRefundAllChains() {
  await init({
    epochPolling: true,
    dbTransactionNamespace: 'gas-refund-computation',
  });

  const epochInfo = EpochInfo.getInstance(CHAIN_ID_MAINNET, true);

  return Promise.allSettled(
    GRP_SUPPORTED_CHAINS.map(async chainId => {
      return Database.sequelize.transaction(async transaction => {
        // acquire lock for chainId (row level only ?)
        await GasRefundParticipation.findOne({
          where: {
            chainId,
          },
          lock: true,
        });

        const lastEpochProcessed = await GasRefundParticipation.max<
          number,
          GasRefundParticipation
        >('epoch', {
          where: {
            isCompleted: false,
            chainId,
          },
        });

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

          assert(
            startCalcTime,
            `could not resolve ${epoch}th epoch start time`,
          );
          assert(endCalcTime, `could not resolve ${epoch}th epoch end time`);
          if (await merkleRootExists({ chainId, epoch }))
            throw new Error(
              `merkle root for chainId=${chainId} epoch=${epoch} already exists`,
            );

          await computeGasRefundAllTxs({
            chainId,
            epoch,
            startTimestamp: startCalcTime,
            endTimestamp: endCalcTime,
          });
        }
      });
    }),
  );
}

startComputingGasRefundAllChains()
  .then(ps => {
    const maybeOneRejected = ps.find(
      (p): p is PromiseRejectedResult => p.status === 'rejected',
    );

    if (maybeOneRejected) {
      throw maybeOneRejected.reason;
    }

    process.exit(0);
  })
  .catch(err => {
    logger.error('startComputingGasRefundAllChains exited with error:', err);
    process.exit(1);
  });
