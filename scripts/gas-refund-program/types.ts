import { GasRefundTransactionData } from '../../src/lib/gas-refund';

export type HistoricalPrice = { [timestamp: string]: number };

export type TxFeesByAddress = {
  [address: string]: GasRefundTransactionData;
};

export type Claimable = {
  address: string;
  amount: string;
};

export type MerkleRoot = {
  merkleRoot: string;
  totalAmount: string;
  epoch: number;
};

export type MerkleData = {
  merkleProofs: string[];
  address: string;
  amount: string;
  epoch: number;
};

export type MerkleTreeData = {
  root: MerkleRoot;
  leaves: MerkleData[];
};

export type StakedPSPByAddress = {
  [address: string]: string;
};

export namespace CovalentAPI {
  export interface Transaction {
    from_address: string
    to_address?: string
    tx_hash: string
    block_height: number;
    block_signed_at: string;
    gas_offered: number,
    gas_spent: number,
    gas_price: number,
    fees_paid: number,
    gas_quote: number,
    gas_quote_rate: number,
    // ... and a lot more
  }
  export interface AddressTransactionsResponse {
    data: {
      data: {
        address: string
        chain_id: string
        quote_currency: string
        items: Transaction[]
        pagination: {
          has_more: boolean
          page_number: number
          page_size: number
          total_count: null
        }
      }
    }
  }
}

export interface CovalentTransaction {
  txHash: string;
  txOrigin: string;
  txGasPrice: string;
  blockNumber: number;
  timestamp: string;
  txGasUsed: string;
}
export interface SubGraphSwap {
  txHash: string;
  txOrigin: string;
  initiator: string;
  txGasPrice: string;
  blockNumber: number;
  timestamp: string;
}

export type GasRefundTransaction = CovalentTransaction

// todo:
// type TransactionType = "swap" | "staking"
