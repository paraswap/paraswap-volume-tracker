import { AddressRewardsMapping, MerkleTreeData } from '../types';
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

type FileMerkleTreeData = {
  root: {
    merkleRoot: string;
    totalAmount: string;
    epoch: number;
  };
  merkleProofs: {
    address: string;
    amount: string;
    epoch: number;
    proof: string[];
  }[];
};

export async function saveMerkleTreeInFile({
  chainId,
  epoch,
  merkleTree,
  userGRPChainsBreakDowns,
}: {
  chainId: number;
  epoch: number;
  merkleTree: MerkleTreeData;
  userGRPChainsBreakDowns: AddressRewardsMapping;
}): Promise<void> {
  const fileLocation = constructFilePath({ chainId, epoch });

  try {
    await mkdir(dir, {
      recursive: true,
    });
  } catch {}

  const fMerkleTree: FileMerkleTreeData = {
    root: merkleTree.root,
    merkleProofs: merkleTree.leaves.map(v => {
      const { merkleProofs, ...r } = v;
      return {
        ...r,
        proof: merkleProofs,
        GRPChainBreakDown: userGRPChainsBreakDowns[r.address],
      };
    }),
  };

  await writeFile(fileLocation, JSON.stringify(fMerkleTree));

  logger.info(`successfully saved merkle tree at ${fileLocation}`);
}
