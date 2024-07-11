import {
  GasRefundTransactionDataWithStakeScore,
  TxProcessorFn,
} from '../gas-refund-program/transactions-indexing/types';

export type PatchedTxTuple = [chainId: number, txHash: string];
export type PatchInput = {
  txs: GasRefundTransactionDataWithStakeScore[];
  processRawTxs: TxProcessorFn;
  chainId: number;
};
