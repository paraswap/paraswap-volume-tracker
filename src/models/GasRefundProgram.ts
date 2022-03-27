import {
  Table,
  Model,
  Column,
  PrimaryKey,
  DataType,
  createIndexDecorator,
} from 'sequelize-typescript';

import { DataType_KECCAK256_HASHED_VALUE } from '../lib/sql-data-types';
import { GasRefundProgramdata } from '../../scripts/gas-refund-program/types';

const compositeIndex = createIndexDecorator({
  name: 'grp_epoch_chain',
  type: 'UNIQUE',
  unique: true,
});

@Table
export class GasRefundProgram extends Model<GasRefundProgramdata> {
  @PrimaryKey
  @Column(DataType_KECCAK256_HASHED_VALUE)
  merkleRoot: string;

  @compositeIndex
  @Column(DataType.SMALLINT)
  epoch: number;

  @compositeIndex
  @Column(DataType.SMALLINT)
  chainId: number;

  @Column(DataType.STRING)
  totalPSPAmountToRefund: string;
}
