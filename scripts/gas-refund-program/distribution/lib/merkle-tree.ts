import { Claimable } from './types';
import { utils, logger } from 'ethers';
import { MerkleTree } from 'merkletreejs';
import { GasRefundTransaction } from '../../../../src/models/GasRefundTransaction';
import BigNumber from 'bignumber.js';
import { MerkleTreeAndChain } from './types';

export type MinGasRefundTransaction = Pick<
  GasRefundTransaction,
  'refundedAmountPSP' | 'address'
>;

export async function computeMerkleData({
  epoch,
  userRewards,
}: {
  epoch: number;
  userRewards: {
    account: string;
    amount: BigNumber;
    chainId: number;
  }[];
}): Promise<MerkleTreeAndChain[]> {
  const userRefundsByChain = userRewards.reduce<{
    [chainId: number]: {
      account: string;
      amount: BigNumber;
      chainId: number;
    }[];
  }>((acc, curr) => {
    if (!acc[curr.chainId]) acc[curr.chainId] = [];
    acc[curr.chainId].push(curr);

    return acc;
  }, {});

  return Object.entries(userRefundsByChain)
    .map(([chainId, rewards]) =>
      computeMerkleDataForChain({
        epoch,
        chainId,
        rewards,
      }),
    )
    .filter(
      chainDistribution => chainDistribution.merkleTree.leaves.length > 0,
    );
}

function computeMerkleDataForChain({
  epoch,
  chainId,
  rewards,
}: {
  epoch: number;
  chainId: string;
  rewards: {
    account: string;
    amount: BigNumber;
    chainId: number;
  }[];
}) {
  const totalAmount = rewards
    .reduce((acc, curr) => acc.plus(curr.amount), new BigNumber(0))
    .toFixed();

  const hashedClaimabled = rewards.reduce<Record<string, Claimable>>(
    (acc, curr) => {
      const { account, amount } = curr;
      const hash = utils.keccak256(
        utils.solidityPack(['address', 'uint256'], [account, amount.toFixed()]),
      );
      acc[hash] = { address: account, amount: amount.toFixed() };
      return acc;
    },
    {},
  );

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
    chainId,
    leaves: merkleLeaves,
  };

  logger.info(
    `chainId=${chainId}, epoch=${epoch} merkleTree for: ${JSON.stringify(
      merkleTreeData.root,
    )}`,
  );

  return {
    merkleTree: merkleTreeData,
    chainId,
  };
}
