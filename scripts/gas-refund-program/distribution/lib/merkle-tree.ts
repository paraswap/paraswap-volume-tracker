import {
  AddressRewardsMapping,
  Claimable,
  GasRefundMerkleProof,
} from './types';
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
  userGRPChainsBreakDowns,
}: {
  epoch: number;
  userRewards: {
    account: string;
    amount: BigNumber;
    chainId: number;
  }[];
  userGRPChainsBreakDowns: {
    [stakeChainId: number]: AddressRewardsMapping;
  };
}): Promise<MerkleTreeAndChain[]> {
  const userRefundsByChain = userRewards.reduce<{
    [chainId: number]: {
      account: string;
      amount: BigNumber;
      chainId: number;
    }[];
  }>((acc, curr) => {
    if (!acc[curr.chainId]) acc[curr.chainId] = [];
    if (curr.amount.isLessThan(0)) {
      throw new Error(
        `Negative amount for ${curr.account} on chain ${curr.chainId}`,
      );
    }
    if (!curr.amount.isZero()) acc[curr.chainId].push(curr);

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
      chainDistribution => chainDistribution.merkleTree.merkleProofs.length > 0,
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

  const merkleLeaves: GasRefundMerkleProof[] = allLeaves.map(leaf => {
    const { address, amount } = hashedClaimabled[leaf];
    const proofs = merkleTree.getHexProof(leaf);
    return {
      address,
      amount,
      epoch,
      proof: proofs,
      // TODO revisit
      GRPChainBreakDown: {},
      amountsByProgram: {},
    };
  });

  const merkleTreeData = {
    root: {
      merkleRoot,
      totalAmount,
      epoch,
    },
    chainId,
    merkleProofs: merkleLeaves,
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
