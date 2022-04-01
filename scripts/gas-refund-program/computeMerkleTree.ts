import '../../src/lib/log4js';
import * as dotenv from 'dotenv';
dotenv.config();
import { computeMerkleData } from './refund/merkle-tree';
import Database from '../../src/database';

import {
  merkleRootExists,
  saveMerkleTreeInDB,
} from './persistance/db-persistance';

import { assert } from 'ts-essentials';
import { GRP_SUPPORTED_CHAINS } from '../../src/lib/gas-refund';
import { GasRefundParticipation } from '../../src/models/GasRefundParticipation';
import { resolveEpochCalcTimeInterval } from './utils';
import { saveMerkleTreeInFile } from './persistance/file-persistance';

const logger = global.LOGGER('GRP:COMPUTE_MERKLE_TREE');

const skipCheck = process.env.SKIP_CHECKS === 'true';
const saveFile = process.env.SAVE_FILE === 'true';

// @FIXME: should cap amount distributed to stakers to 30k
export async function computeAndStoreMerkleTreeForChain({
  chainId,
  epoch,
}: {
  chainId: number;
  epoch: number;
}) {
  if (!skipCheck && (await merkleRootExists({ chainId, epoch })))
    return logger.warn(
      `merkle root for chainId=${chainId} epoch=${epoch} already exists`,
    );

  const gasRefundParticipations = await GasRefundParticipation.findAll({
    where: { epoch, chainId },
  });

  const merkleTree = await computeMerkleData({
    chainId,
    epoch,
    gasRefundParticipations,
  });

  if (saveFile) {
    logger.info('saving merkle tree in file');
    await saveMerkleTreeInFile({ chainId, epoch, merkleTree });
  } else {
    logger.info('saving merkle tree in db');
    await saveMerkleTreeInDB({ chainId, epoch, merkleTree });
  }
}

async function startComputingMerkleTreesAllChains() {
  const epoch = Number(process.env.GRP_EPOCH) || 8; // @TODO: automate
  await Database.connectAndSync();

  const { isEpochEnded } = await resolveEpochCalcTimeInterval(epoch);

  if (!skipCheck)
    assert(
      isEpochEnded,
      `Epoch ${epoch} has not ended or data not available yet`,
    );

  await Promise.all(
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
