import { MerkleTreeData } from '../types';
import { writeFile, mkdir } from 'fs/promises';
import * as path from 'path';

const dir = path.join(__dirname, './merkle-trees');

const constructFilePath = ({
  chainId,
  epoch,
}: {
  chainId: number;
  epoch: number;
}) => path.join(dir, `merkletree-chain-${chainId}-epoch-${epoch}.json`);

const logger = global.LOGGER('GRP:MERKLE_TREE:SAVE_FILE');

export async function saveMerkleTreeInFile({
  chainId,
  epoch,
  merkleTree,
}: {
  chainId: number;
  epoch: number;
  merkleTree: MerkleTreeData;
}): Promise<void> {
  const fileLocation = constructFilePath({ chainId, epoch });

  try {
    await mkdir(dir, {
      recursive: true,
    });
  } catch {}

  await writeFile(fileLocation, JSON.stringify(merkleTree));

  logger.info(`successfully saved merkle tree at ${fileLocation}`);
}
