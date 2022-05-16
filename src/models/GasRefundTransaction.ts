import {
  Table,
  Model,
  Column,
  PrimaryKey,
  DataType,
  AutoIncrement,
  Index,
} from 'sequelize-typescript';
import { GasRefundTransactionData, TransactionStatus } from '../lib/gas-refund';

import {
  DataType_ADDRESS,
  DataType_KECCAK256_HASHED_VALUE,
} from '../lib/sql-data-types';

@Table
export class GasRefundTransaction extends Model<GasRefundTransactionData> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  id: number;

  @Index
  @Column(DataType.SMALLINT)
  epoch: number;

  @Column(DataType_ADDRESS)
  address: string;

  @Column(DataType.INTEGER)
  chainId: number;

  @Column(DataType_KECCAK256_HASHED_VALUE)
  hash: string;

  @Column(DataType.INTEGER)
  block: number;

  @Column(DataType.INTEGER)
  timestamp: number;

  @Column(DataType.BIGINT)
  gasUsed: string; // @debug

  @Column(DataType.BIGINT)
  gasPrice: string; // debug

  @Column(DataType.DECIMAL)
  gasUsedChainCurrency: string; // @debug

  @Column(DataType.DECIMAL)
  gasUsedUSD: string; // @debug

  @Column(DataType.DECIMAL)
  pspUsd: number;

  @Column(DataType.DECIMAL)
  chainCurrencyUsd: number; // @debug

  @Column(DataType.DECIMAL)
  pspChainCurrency: number; // @debug

  @Column(DataType.DECIMAL)
  totalStakeAmountPSP: string; // @debug

  @Column(DataType.DECIMAL)
  refundedAmountPSP: string;

  @Column(DataType.DECIMAL)
  refundedAmountUSD: string;

  @Index
  @Column(DataType_ADDRESS)
  contract: string;

  @Index
  @Column(DataType.STRING)
  status: TransactionStatus;
}
