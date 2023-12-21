import { AddressRewardsMapping, MerkleTreeData } from '../types';
import { writeFile, mkdir } from 'fs/promises';
import * as path from 'path';
import { stringifyGRPChainBreakDown } from '../../../src/lib/gas-refund/gas-refund';

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
    amountsByProgram?: Record<string, string>;
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
        GRPChainBreakDown: stringifyGRPChainBreakDown(
          userGRPChainsBreakDowns[r.address].byChain,
        ),
        amountsByProgram: userGRPChainsBreakDowns[r.address].amountsByProgram,
      };
    }),
  };

  await writeFile(fileLocation, JSON.stringify(fMerkleTree));

  logger.info(`successfully saved merkle tree at ${fileLocation}`);
}
