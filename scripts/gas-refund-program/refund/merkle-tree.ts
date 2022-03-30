import { Claimable, MerkleTreeData } from '../types';
import { utils } from 'ethers';
import { MerkleTree } from 'merkletreejs';
import { GasRefundParticipant } from '../../../src/models/GasRefundParticipant';

export async function computeMerkleData({
  chainId,
  epoch,
  gasRefundParticipants,
}: {
  chainId: number;
  epoch: number;
  gasRefundParticipants: Pick<
    GasRefundParticipant,
    'refundedAmountPSP' | 'address'
  >[];
}): Promise<MerkleTreeData> {
  const logger = global.LOGGER(
    `GRP:COMPUTE_MERKE_TREE: chainId=${chainId}, epoch=${epoch}`,
  );

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
    `merkleTree for chainId=${chainId}: ${JSON.stringify(merkleTreeData.root)}`,
  );

  return merkleTreeData;
}
