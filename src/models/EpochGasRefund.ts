import {
  Table,
  Model,
  Column,
  Index,
  AllowNull,
  PrimaryKey,
  Default,
  DataType,
  Scopes,
  AutoIncrement,
  Unique,
  createIndexDecorator,
} from 'sequelize-typescript';

import { DataType_ADDRESS } from '../lib/sql-data-types';
import { EpochGasRefundData } from '../service/transaction-fees-indexer/types';

const compositeIndex = createIndexDecorator({
  name: 'epochgasrefund_epoch_address_chain',
  type: 'UNIQUE',
  unique: true,
});

@Table
export class EpochGasRefund extends Model<EpochGasRefundData> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER.UNSIGNED)
  id: string;

  @compositeIndex
  @Column(DataType.SMALLINT.UNSIGNED)
  epoch: number;

  @compositeIndex
  @Column(DataType_ADDRESS)
  address: string;

  @compositeIndex
  @Column(DataType.STRING(5))
  chainId: string;

  @Column // todo: refactor, better data type
  accumulatedGasUsedPSP: string;
  // todo: more accumulated gas props; accGasUsed, accGasUsedChainCurrency

  @Column
  lastBlockNum: number;

  @AllowNull(true)
  @Column // todo: refactor, better data type
  totalStakeAmountPSP: string;

  @AllowNull(true)
  @Column // todo: refactor, better data type
  refundedAmountPSP: string;

  @AllowNull(true)
  @Column({
    type: DataType.ARRAY(DataType.STRING()),
  }) // todo: refactor, better data type
  merkleProofs: string[];

  @AllowNull(true)
  // todo: make a string? DataType_ADDRESS ?
  @Column(DataType.JSONB) // todo: refactor, better data type
  merkleRoot: string;
}
