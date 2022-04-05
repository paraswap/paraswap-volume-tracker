import { Claimable, MerkleTreeData } from '../types';
import { utils, logger } from 'ethers';
import { MerkleTree } from 'merkletreejs';
import { GasRefundParticipation } from '../../../src/models/GasRefundParticipation';

export type MinGasRefundParticipation = Pick<
  GasRefundParticipation,
  'refundedAmountPSP' | 'address'
>;

export async function computeMerkleData({
  chainId,
  epoch,
  gasRefundParticipations,
}: {
  chainId: number;
  epoch: number;
  gasRefundParticipations: MinGasRefundParticipation[];
}): Promise<MerkleTreeData> {
  const totalAmount = gasRefundParticipations
    .reduce((acc, curr) => (acc += BigInt(curr.refundedAmountPSP)), BigInt(0))
    .toString();

  const hashedClaimabled = gasRefundParticipations.reduce<
    Record<string, Claimable>
  >((acc, curr) => {
    const { address, refundedAmountPSP } = curr;
    const hash = utils.keccak256(
      utils.solidityPack(['address', 'uint256'], [address, refundedAmountPSP]),
    );
    acc[hash] = { address, amount: refundedAmountPSP };
    return acc;
  }, {});

  const allLeaves = Object.keys(hashedClaimabled);

  const merkleTree = new MerkleTree(allLeaves, utils.keccak256, { sort: true });

  const merkleRoot = merkleTree.getHexRoot();

  const merkleLeaves = allLeaves.map(leaf => {
    const { address, amount } = hashedClaimabled[leaf];
    const proofs = merkleTree.getHexProof(leaf);
    return { address, amount, epoch, merkleProofs: proofs };
  });

  const merkleTreeData = {
    root: {
      merkleRoot,
      totalAmount,
      epoch,
    },
    leaves: merkleLeaves,
  };

  logger.info(
    `chainId=${chainId}, epoch=${epoch} merkleTree for: ${JSON.stringify(
      merkleTreeData.root,
    )}`,
  );

  return merkleTreeData;
}
