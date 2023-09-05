import * as Sequelize from 'sequelize';
import { GasRefundTransactionData } from './gas-refund';
import { GasRefundTransactionStakeSnapshotData } from '../../models/GasRefundTransactionStakeSnapshot';
import Database from '../../database';
import BigNumber from 'bignumber.js';

const QUERY = `
select
	grt.*, grtss.*
from
	"GasRefundTransactions" grt
left join "GasRefundTransactionStakeSnapshots" grtss on
	grt.hash = grtss."transactionHash"
	and grt."chainId" = grtss."transactionChainId"
where 
    grt.address = :address 
    and grt.epoch between :epochFrom and :epochTo
`;

type PickedStakeSnapshotData = Pick<
  GasRefundTransactionStakeSnapshotData,
  | 'stakeChainId'
  | 'stakeScore'
  | 'bptPSPBalance'
  | 'bptTotalSupply'
  | 'claimableSePSP1Balance'
  | 'sePSP1Balance'
  | 'sePSP2Balance'
>;
type TransactionWithStakeChainScore = GasRefundTransactionData &
  PickedStakeSnapshotData;

type TransactionWithStakeChainScoreByStakeChain = GasRefundTransactionData & {
  stakeByChain: Record<number, PickedStakeSnapshotData>;
};

//NB: running into a problem with null not converting into Bigin most likely means that some of the fetched txs don't have a StakeSnapshot match in the LEFT JOIN above
export async function loadTransactionWithByStakeChainData({
  address,
  epochFrom,
  epochTo,
}: {
  address: string;
  epochFrom: number;
  epochTo: number;
}): Promise<TransactionWithStakeChainScoreByStakeChain[]> {
  const rows = await Database.sequelize.query<TransactionWithStakeChainScore>(
    QUERY,
    {
      type: Sequelize.QueryTypes.SELECT,
      raw: true,
      replacements: {
        address,
        epochFrom,
        epochTo,
      },
    },
  );

  const withByStakeChain = rows.reduce<
    Record<string, TransactionWithStakeChainScoreByStakeChain>
  >((acc, row) => {
    const {
      stakeChainId,
      stakeScore,
      bptPSPBalance,
      bptTotalSupply,
      claimableSePSP1Balance,
      sePSP1Balance,
      sePSP2Balance,

      ...originalTransaction
    } = row;
    const rowIdx = `${originalTransaction.chainId}-${originalTransaction.hash}`;
    const accumulatedRow = {
      ...originalTransaction,
      ...acc[rowIdx],
      stakeByChain: {
        ...acc[rowIdx]?.stakeByChain,
        [stakeChainId]: {
          stakeChainId,
          stakeScore,
          bptPSPBalance,
          bptTotalSupply,
          claimableSePSP1Balance,
          sePSP1Balance,
          sePSP2Balance,
        },
      },
    };
    return {
      ...acc,
      [rowIdx]: accumulatedRow,
    };
  }, {});

  const results = Object.values(withByStakeChain);
  return results;
}

type TransactionWithCaimableByStakeChain =
  TransactionWithStakeChainScoreByStakeChain & {
    claimableByStakeChain: Record<number, BigNumber>;
  };

type ComputeAggregatedStakeChainDetailsResult = {
  transactionsWithClaimableByChain: TransactionWithCaimableByStakeChain[];
  refundedByChain: Record<number, BigNumber>;
  claimableByChain: Record<number, BigNumber>;
};

type ComputationOptions = { roundBignumber: (v: BigNumber) => BigNumber };
const defaultRounder = (v: BigNumber) =>
  v.decimalPlaces(0, BigNumber.ROUND_DOWN);

// beware, because the operations involve division, the Bignumbers returned would be with non-integers
export function computeAggregatedStakeChainDetails(
  transactions: TransactionWithStakeChainScoreByStakeChain[],
  options?: ComputationOptions,
): ComputeAggregatedStakeChainDetailsResult {
  const roundBignumber = options?.roundBignumber ?? defaultRounder;

  const refundedByChain = transactions.reduce<Record<number, BigNumber>>(
    (acc, tx) => {
      if (!acc[tx.chainId]) acc[tx.chainId] = new BigNumber(0);
      acc[tx.chainId] = acc[tx.chainId].plus(tx.refundedAmountPSP);
      return acc;
    },
    {},
  );

  const transactionsWithClaimableByChain: TransactionWithCaimableByStakeChain[] =
    transactions.map(tx => {
      const sumStakeScore = Object.values(tx.stakeByChain).reduce(
        (acc, stake) => acc + BigInt(stake.stakeScore),
        BigInt(0),
      );

      const claimableByStakeChainForTx: Record<number, BigNumber> =
        Object.values(tx.stakeByChain).reduce(
          (acc, stake) => ({
            ...acc,
            [stake.stakeChainId]: roundBignumber(
              new BigNumber(stake.stakeScore)
                .div(sumStakeScore.toString())
                .multipliedBy(tx.refundedAmountPSP),
            ),
          }),
          {},
        );

      return {
        ...tx,
        claimableByStakeChain: claimableByStakeChainForTx,
      };
    });

  const claimableByChain = transactionsWithClaimableByChain.reduce<
    Record<number, BigNumber>
  >((acc, tx) => {
    Object.entries(tx.claimableByStakeChain).forEach(
      ([stakeChainId, claimable]) => {
        const chainId = Number(stakeChainId);
        if (!acc[chainId]) acc[chainId] = claimable;
        else acc[chainId] = acc[chainId].plus(claimable);
      },
    );
    return acc;
  }, {});

  return {
    transactionsWithClaimableByChain,
    refundedByChain,
    claimableByChain,
  };
}
