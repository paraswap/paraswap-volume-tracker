import { MerkleTreeData } from './types';
import { writeFile, readFile, mkdir } from 'fs/promises';
import * as path from 'path';

const dir = path.join(__dirname, './merkle-trees');

const logger = global.LOGGER('GAS_REFUND:PERSISTANCE');

const constructFilePath = ({
  chainId,
  epochNum,
}: {
  chainId: number;
  epochNum: number;
}) => path.join(dir, `merkletree-chain-${chainId}-epoch-${epochNum}.json`);

export async function saveMerkleTree({
  chainId,
  epochNum,
  merkleTree,
}: {
  chainId: number;
  epochNum: number;
  merkleTree: MerkleTreeData | null;
}) {
  const fileLocation = constructFilePath({ chainId, epochNum });

  try {
    await mkdir(dir, {
      recursive: true,
    });
  } catch {}
  await writeFile(fileLocation, JSON.stringify(merkleTree));
}

export async function getMerkleTree({
  chainId,
  epochNum,
}: {
  chainId: number;
  epochNum: number;
}) {
  const fileLocation = constructFilePath({ chainId, epochNum });

  try {
    const data = await readFile(fileLocation);

    return JSON.parse(data.toString()) as MerkleTreeData;
  } catch (e) {
    logger.error(
      `Failed to read merkle tree for chain=${chainId} epoch=${epochNum} `,
      e,
    );
    return null;
  }
}
