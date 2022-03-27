import {
  Table,
  Model,
  Column,
  AllowNull,
  PrimaryKey,
  DataType,
  AutoIncrement,
  createIndexDecorator,
  Index,
} from 'sequelize-typescript';

import {
  DataType_ADDRESS,
  DataType_KECCAK256_HASHED_VALUE,
} from '../lib/sql-data-types';
import { EpochGasRefundData } from '../../scripts/gas-refund-program/types';

const compositeIndex = createIndexDecorator({
  name: 'epochgasrefund_epoch_address_chain',
  type: 'UNIQUE',
  unique: true,
});

@Table
export class GasRefundParticipant extends Model<EpochGasRefundData> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  id: number;

  @compositeIndex
  @Column(DataType.SMALLINT)
  epoch: number;

  @compositeIndex
  @Column(DataType_ADDRESS)
  address: string;

  @compositeIndex
  @Column(DataType.SMALLINT)
  chainId: number;

  @Column(DataType.BOOLEAN)
  isCompleted: boolean;

  @Index
  @Column(DataType.INTEGER)
  lastBlockNum: number;

  @Column(DataType.STRING)
  accumulatedGasUsed: string;

  @Column(DataType.STRING)
  accumulatedGasUsedPSP: string;

  @AllowNull(true)
  @Column(DataType.STRING)
  totalStakeAmountPSP: string;

  @AllowNull(true)
  @Column(DataType.STRING)
  refundedAmountPSP: string;

  @AllowNull(true)
  @Column({
    type: DataType.ARRAY(DataType_KECCAK256_HASHED_VALUE),
  })
  merkleProofs: string[];
}
