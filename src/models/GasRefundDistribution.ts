import {
  Table,
  Model,
  Column,
  PrimaryKey,
  DataType,
  createIndexDecorator,
} from 'sequelize-typescript';
import { GasRefundDistributionData } from '../lib/gas-refund';

import { DataType_KECCAK256_HASHED_VALUE } from '../lib/sql-data-types';

const compositeIndex = createIndexDecorator({
  name: 'grp_epoch_chain',
  type: 'UNIQUE',
  unique: true,
});

@Table
export class GasRefundDistribution extends Model<GasRefundDistributionData> {
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
