import { GasRefundTransactionData } from '../../../src/lib/gas-refund/gas-refund';
import { ExtendedCovalentGasRefundTransaction } from '../../../src/types-from-scripts';
import { StakedScoreV1, StakedScoreV2, StakedScoreV3 } from '../staking/stakes-tracker';

export type GasRefundTransactionDataWithStakeScore =
  GasRefundTransactionData & {
    stakeScore: StakedScoreV2 | StakedScoreV1 | StakedScoreV3;
  };

export type TxProcessorFn = (
  transactions: ExtendedCovalentGasRefundTransaction[],
  computeRefundPercent: (
    epoch: number,
    totalPSPorTotalParaboostScore: string,
  ) => number | undefined,
) => Promise<GasRefundTransactionDataWithStakeScore[]>;
