import {
  Table,
  Model,
  Column,
  PrimaryKey,
  DataType,
  AutoIncrement,
} from 'sequelize-typescript';

import {
  DataType_ADDRESS,
  DataType_KECCAK256_HASHED_VALUE,
} from '../lib/sql-data-types';

export type DuneRow = Partial<{
  to: string;
  hash: string; // "0x2d1ee3a53c73556a730084043664ed85b4786fd6de333c1f8c81b66509360e68",
  from: string;
  gas_price: string; // "100000058",
  gas_used: number;
  block_number: number;
  l1_fee: string;
  success: boolean;

  // network: string;
  chainId: number;
  contract: string;

  block_time: string;
  block_timestamp: number; // decorated
}>;

@Table
export class DuneTransaction extends Model<DuneRow> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  id: number;

  @Column(DataType.INTEGER)
  chainId: number;

  @Column(DataType_ADDRESS)
  to: string;

  @Column(DataType_KECCAK256_HASHED_VALUE)
  hash: string;

  @Column(DataType_ADDRESS)
  from: string;

  @Column(DataType_ADDRESS)
  contract: string;

  @Column(DataType.INTEGER)
  block_number: number;

  @Column(DataType.DECIMAL)
  gas_price: string;

  @Column(DataType.INTEGER)
  gas_used: number;

  @Column(DataType.INTEGER)
  block_timestamp: number; // decorated

  @Column(DataType.DECIMAL)
  l1_fee: string;

  @Column(DataType.BOOLEAN)
  success: boolean;
}
