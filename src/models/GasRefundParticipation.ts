import {
  Table,
  Model,
  Column,
  AllowNull,
  PrimaryKey,
  DataType,
  AutoIncrement,
  createIndexDecorator,
} from 'sequelize-typescript';
import { GasRefundParticipantData } from '../lib/gas-refund/gas-refund';

import {
  DataType_ADDRESS,
  DataType_KECCAK256_HASHED_VALUE,
} from '../lib/sql-data-types';
import { AmountsByProgram, ChainBalanceMapping } from '../types';

const compositeIndex = createIndexDecorator({
  name: 'epochgasrefund_epoch_address_chain',
  type: 'UNIQUE',
  unique: true,
});

@Table
export class GasRefundParticipation extends Model<GasRefundParticipantData> {
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
  @Column(DataType.INTEGER)
  chainId: number;

  @AllowNull(true)
  @Column({
    type: DataType.ARRAY(DataType_KECCAK256_HASHED_VALUE),
  })
  merkleProofs: string[];

  @AllowNull(true)
  @Column({ type: DataType.JSONB })
  GRPChainBreakDown: ChainBalanceMapping;

  @AllowNull(true)
  @Column({ type: DataType.JSONB })
  amountsByProgram: AmountsByProgram;

  @AllowNull(true)
  @Column(DataType.DECIMAL)
  amount: string;

  @AllowNull(true)
  @Column({ type: DataType.JSONB })
  debugInfo: any;
}
