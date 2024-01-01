import { TransactionRequest } from '@ethersproject/providers';

type Transaction = TransactionRequest;

export interface SafeProposalConfig {
  version: string;
  chainId: string;
  createdAt: number;
  meta: Meta;
  transactions: Transaction[];
}

export interface Meta {
  name: string;
  txBuilderVersion: string;
  createdFromSafeAddress: string;
  checksum: string;
}

export const generateSafeProposal = (
  safeAddress: string,
  chainId: number,
  txs: Transaction[],
): SafeProposalConfig => {
  return {
    version: '1.0',
    chainId: String(chainId),
    createdAt: Date.now(),
    meta: {
      name: 'Transactions Batch',
      txBuilderVersion: '1.14.1',
      createdFromSafeAddress: safeAddress,
      checksum: '', // FIXME: calculate to prevent warning on safe ui. Minor
    },
    transactions: txs.map(tx => {
      const { to, value, data } = tx;
      return {
        to,
        data,
        value: value || '0',
      };
    }),
  };
};
