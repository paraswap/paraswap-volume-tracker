import { Claimable, MerkleTreeData } from '../types';
import { logger, utils } from 'ethers';
import { MerkleTree } from 'merkletreejs';
import { GasRefundParticipant } from '../../../src/models/GasRefundParticipant';

export async function computeMerkleData(
  chainId: number,
  gasRefundParticipants: GasRefundParticipant[],
  epoch: number,
): Promise<MerkleTreeData> {
  const totalAmount = gasRefundParticipants
    .reduce((acc, curr) => (acc += BigInt(curr.refundedAmountPSP)), BigInt(0))
    .toString();

  const hashedClaimabled = gasRefundParticipants.reduce<
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

  const tree = new MerkleTree(allLeaves, utils.keccak256, { sort: true });

  logger.info(`merkleTree for chainId=${chainId}: ${tree.toString()}`);

  const merkleRoot = tree.getHexRoot();

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
