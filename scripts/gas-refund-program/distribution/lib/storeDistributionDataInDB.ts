import { assert } from 'ts-essentials';
import database from '../../../../src/database';
import { sliceCalls } from '../../../../src/lib/utils/helpers';

import { GasRefundDistribution } from '../../../../src/models/GasRefundDistribution';
import { GasRefundParticipation } from '../../../../src/models/GasRefundParticipation';
import { GasRefundParticipantData } from '../../../../src/lib/gas-refund/gas-refund';
import { GasRefundMerkleProof, GasRefundMerkleTree } from './types';

export async function storeDistributionDataInDB(
  chainId: number,
  merkleTree: GasRefundMerkleTree,
) {
  const {
    root: { epoch, merkleRoot, totalAmount },
    merkleProofs: leaves,
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

    const epochDataToUpdate: GasRefundParticipantData[] = leaves.map(
      (leaf: GasRefundMerkleProof) => {
        const {
          address: account,
          proof: merkleProofs,
          amount,
          GRPChainBreakDown,
          amountsByProgram,
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
