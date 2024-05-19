import { assert } from 'ts-essentials';
import database from '../../../../src/database';
import { sliceCalls } from '../../../../src/lib/utils/helpers';

import { GasRefundDistribution } from '../../../../src/models/GasRefundDistribution';
import { GasRefundParticipation } from '../../../../src/models/GasRefundParticipation';
import { GasRefundParticipantData } from '../../../../src/lib/gas-refund/gas-refund';
import { RewardMerkleProof, RewardMerkleTree } from './types';

export async function storeDistributionDataInDB(
  chainId: number,
  merkleTree: RewardMerkleTree,
) {
  const {
    root: { epoch, merkleRoot, totalAmount },
    merkleProofs,
  } = merkleTree;

  await database.sequelize?.transaction(async t => {
    await GasRefundDistribution.create(
      {
        epoch,
        chainId,
        totalPSPAmountToRefund: totalAmount,
        merkleRoot,
      },
      {
        transaction: t,
      },
    );

    const epochDataToUpdate: GasRefundParticipantData[] = merkleProofs.map(
      (leaf: RewardMerkleProof) => {
        const {
          address: account,
          proof: merkleProofs,
          amount,
          GRPChainBreakDown,
          amountsByProgram,
          debugInfo,
        } = leaf;
        assert(
          account == account.toLowerCase(),
          `LOGIC ERROR: ${account} should be lowercased`,
        );
        return {
          epoch,
          address: account,
          chainId: chainId,
          merkleProofs,
          isCompleted: true,
          amount,
          GRPChainBreakDown,
          amountsByProgram,
          debugInfo,
        };
      },
    );

    const bulkUpdateParticipations = async (
      participantsToUpdate: GasRefundParticipantData[],
    ) => {
      await GasRefundParticipation.bulkCreate(participantsToUpdate, {
        updateOnDuplicate: ['merkleProofs', 'isCompleted'],
        transaction: t,
      });
    };

    await Promise.all(
      sliceCalls({
        inputArray: epochDataToUpdate,
        execute: bulkUpdateParticipations,
        sliceLength: 100,
      }),
    );
  });
}
