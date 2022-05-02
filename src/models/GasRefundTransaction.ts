import {
  Table,
  Model,
  Column,
  PrimaryKey,
  DataType,
  AutoIncrement,
  createIndexDecorator,
  Index,
} from 'sequelize-typescript';
import { GasRefundTransactionData } from '../lib/gas-refund';

import {
  DataType_ADDRESS,
  DataType_KECCAK256_HASHED_VALUE,
} from '../lib/sql-data-types';

const compositeIndex = createIndexDecorator({
  name: 'gas_refund_transaction_chain_id_hash_occurence',
  type: 'UNIQUE',
  unique: true,
});

@Table
export class GasRefundTransaction extends Model<GasRefundTransactionData> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  id: number;

  @Index
  @Column(DataType.SMALLINT)
  epoch: number;

  // todo: is this index needed?
  @Index
  @Column(DataType_ADDRESS)
  address: string;

  @compositeIndex
  @Column(DataType.INTEGER)
  chainId: number;

  @compositeIndex
  @Column(DataType_KECCAK256_HASHED_VALUE)
  hash: string;

  @compositeIndex
  @Column(DataType.SMALLINT.UNSIGNED)
  occurence: number;

  @Column(DataType.INTEGER)
  block: number;

  @Column(DataType.INTEGER)
  timestamp: number;

  @Column(DataType.BIGINT)
  gasUsed: string; // @debug

  @Column(DataType.DECIMAL)
  gasUsedChainCurrency: string; // @debug

  @Column(DataType.DECIMAL)
  gasUsedPSP: string; // @debug

  @Column(DataType.DECIMAL)
  gasUsedUSD: string; // @debug

  @Column(DataType.DECIMAL)
  totalStakeAmountPSP: string; // @debug

  @Column(DataType.DECIMAL)
  refundedAmountPSP: string;

  @Column(DataType.DECIMAL)
  refundedAmountUSD: string;
}
