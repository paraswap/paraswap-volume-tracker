import { MerkleTreeData } from '../types';
import { logger, utils } from 'ethers';
import { MerkleTree } from 'merkletreejs';

export type Claimable = {
  address: string;
  amount: string;
};

export async function computeMerkleData(
  chainId: number,
  amounts: Claimable[],
  epoch: number,
): Promise<MerkleTreeData | null> {
  const totalAmount = amounts
    .reduce((acc, curr) => (acc += BigInt(curr.amount)), BigInt(0))
    .toString();

  const hashedClaimabled = amounts.reduce<Record<string, Claimable>>(
    (acc, curr) => {
      const { address, amount } = curr;
      const hash = utils.keccak256(
        utils.solidityPack(['address', 'uint256'], [address, amount]),
      );
      acc[hash] = { address, amount };
      return acc;
    },
    {},
  );

  const allLeaves = Object.keys(hashedClaimabled);

  const tree = new MerkleTree(allLeaves, utils.keccak256, { sort: true });

  logger.info(`merkleTree for chainId=${chainId}: ${tree.toString()}`);

  const merkleRoot = '0x' + tree.getRoot().toString('hex');

  const merkleLeaves = allLeaves.map(leaf => {
    const { address, amount } = hashedClaimabled[leaf];
    const proofs = tree.getHexProof(leaf);
    return { address, amount, epoch, merkleProofs: proofs };
  });

  return {
    root: {
      merkleRoot,
      totalAmount,
      epoch,
    },
    leaves: merkleLeaves,
  };
}
