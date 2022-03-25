import { MerkleTreeData } from './types';
import { writeFile, readFile, mkdir } from 'fs/promises';
import * as path from 'path';

const dir = path.join(__dirname, './merkle-trees');

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

  const data = await readFile(fileLocation);

  return JSON.parse(data.toString()) as MerkleTreeData | null;
}
