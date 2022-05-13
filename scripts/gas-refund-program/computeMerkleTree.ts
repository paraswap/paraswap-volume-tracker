import '../../src/lib/log4js';
import * as dotenv from 'dotenv';
dotenv.config();
import { computeMerkleData } from './refund/merkle-tree';
import {
  merkleRootExists,
  saveMerkleTreeInDB,
} from './persistance/db-persistance';

import { assert } from 'ts-essentials';
import { Sequelize } from 'sequelize-typescript';
import {
  GasRefundGenesisEpoch,
  GRP_SUPPORTED_CHAINS,
  TransactionStatus,
} from '../../src/lib/gas-refund';
import { GasRefundTransaction } from '../../src/models/GasRefundTransaction';
import { saveMerkleTreeInFile } from './persistance/file-persistance';
import { init, resolveEpochCalcTimeInterval } from './common';

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

  // check if none transactions is idle before computing merkle tree

  const gasRefundParticipations: {
    address: string;
    refundedAmountPSP: string;
  }[] = await GasRefundTransaction.findAll({
    where: {
      epoch,
      chainId,
      status: TransactionStatus.VALIDATED,
    },
    attributes: [
      'address',
      [
        Sequelize.fn('SUM', Sequelize.col('refundedAmountPSP')),
        'refundedAmountPSP',
      ],
    ],
    group: ['address'],
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
  await init();

  const epoch = Number(process.env.GRP_EPOCH) || GasRefundGenesisEpoch; // @TODO: automate

  assert(
    epoch >= GasRefundGenesisEpoch,
    'cannot compute grp merkle data for epoch < genesis_epoch',
  );

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
