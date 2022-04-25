import '../../src/lib/log4js';
import * as dotenv from 'dotenv';
dotenv.config();
import { computeMerkleData, MinGasRefundParticipation } from './refund/merkle-tree';

import {
  merkleRootExists,
  saveMerkleTreeInDB,
} from './persistance/db-persistance';

import { assert } from 'ts-essentials';
import BigNumber from 'bignumber.js';
import {
  GasRefundGenesisEpoch,
  GRP_SUPPORTED_CHAINS,
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

  const gasRefundTXs = await GasRefundTransaction.findAll({
    where: { epoch, chainId },
  });

  const addressRefunds: Record<string, string> = {}

  // todo: refactor this, looks basic
  for(let i = 0; i < gasRefundTXs.length; i++) {
    const { address, refundedAmountPSP } = gasRefundTXs[i]
    if (!addressRefunds[address]) {
      addressRefunds[address] = new BigNumber(refundedAmountPSP).toFixed(0)
    } else {
      addressRefunds[address] = (new BigNumber(addressRefunds[address]).plus(new BigNumber(refundedAmountPSP))).toString()
    }
  }
  const gasRefundParticipations: MinGasRefundParticipation[] = Object.entries(addressRefunds).map(([address, refundedAmountPSP]) => ({address, refundedAmountPSP}))

  const merkleTree = await computeMerkleData({
    chainId,
    epoch,
    gasRefundParticipations
  });

  if (saveFile) {
    logger.info('saving merkle tree in file');
    await saveMerkleTreeInFile({ chainId, epoch, merkleTree });
  } else {
    logger.info('saving merkle tree in db');
    await saveMerkleTreeInDB({ chainId, epoch, merkleTree, addressRefundedAmountPSP: addressRefunds });
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
    // todo: reinstate next line over subsequent
    // GRP_SUPPORTED_CHAINS.map(chainId =>
    [250].map(chainId =>
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
