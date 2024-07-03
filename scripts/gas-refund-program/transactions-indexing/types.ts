import { GasRefundTransactionData } from '../../../src/lib/gas-refund/gas-refund';
import { StakedScoreV1, StakedScoreV2 } from '../staking/stakes-tracker';

export type GasRefundTransactionDataWithStakeScore =
  GasRefundTransactionData & {
    stakeScore: StakedScoreV2 | StakedScoreV1;
  };
