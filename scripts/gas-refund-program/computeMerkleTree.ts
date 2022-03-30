import '../../src/lib/log4js';
import * as dotenv from 'dotenv';
dotenv.config();
import { computeMerkleData } from './refund/merkle-tree';
import Database from '../../src/database';

import {
  merkleRootExists,
  writeCompletedEpochData,
} from './persistance/db-persistance';

import { assert } from 'ts-essentials';
import { GRP_SUPPORTED_CHAINS } from '../../src/lib/gas-refund';
import { GasRefundParticipant } from '../../src/models/GasRefundParticipant';
import { resolveEpochCalcTimeInterval } from './utils';

const logger = global.LOGGER('GRP');

// @FIXME: should cap amount distributed to stakers to 30k
export async function computeAndStoreMerkleTreeForChain({
  chainId,
  epoch,
}: {
  chainId: number;
  epoch: number;
}) {
  if (await merkleRootExists({ chainId, epoch }))
    return logger.warn(
      `merkle root for chainId=${chainId} epoch=${epoch} already exists`,
    );

  const claimables = await GasRefundParticipant.findAll({
    where: { epoch, chainId },
  });

  const merkleTree = await computeMerkleData(chainId, claimables, epoch);

  await writeCompletedEpochData(chainId, merkleTree);
}

async function startComputingMerkleTreesAllChains() {
  const epoch = Number(process.env.GRP_EPOCH) || 8; // @TODO: automate
  await Database.connectAndSync();

  const { isEpochEnded } = await resolveEpochCalcTimeInterval(epoch);

  assert(
    isEpochEnded,
    `Epoch ${epoch} has not ended or data not available yet`,
  );

  await Promise.allSettled(
    GRP_SUPPORTED_CHAINS.map(chainId =>
      computeAndStoreMerkleTreeForChain({
        chainId,
        epoch,
      }),
    ),
  );
}

startComputingMerkleTreesAllChains()
  .then(() => process.exit(0))
  .catch(err => {
    logger.error('computeMerkleTreesAllChains exited with error:', err);
    process.exit(1);
  });
