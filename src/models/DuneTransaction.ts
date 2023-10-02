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
  network: string;
  chainId: number;
  contract: string;
  block_hash: string;
  from: string;
  gas_price: string; // "100000058",
  hash: string; // "0x2d1ee3a53c73556a730084043664ed85b4786fd6de333c1f8c81b66509360e68",
  l1_tx_origin: string | null;
  to: string;
  value: string;
  l1_fee_scalar: string;
  block_number: number;
  block_time: string;

  block_timestamp: number; // decorated

  gas_limit: number;
  gas_used: number;
  index: number;
  l1_block_number: number;
  l1_fee: string;
  l1_gas_price: string;
  l1_gas_used: number;
  l1_timestamp: number;
  max_fee_per_gas: string;
  max_priority_fee_per_gas: string;
  nonce: number;
  priority_fee_per_gas: string;
  success: boolean;
  type: string;
  block_date: string;
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
  contract: string;

  @Column(DataType_KECCAK256_HASHED_VALUE)
  block_hash: string;

  @Column(DataType_ADDRESS)
  from: string;

  @Column(DataType.DECIMAL)
  gas_price: string;

  @Column(DataType_KECCAK256_HASHED_VALUE)
  hash: string;

  @Column(DataType.DECIMAL)
  l1_tx_origin: string;

  @Column(DataType_ADDRESS)
  to: string;

  @Column(DataType.DECIMAL)
  value: string;

  @Column(DataType.DECIMAL)
  l1_fee_scalar: string;

  @Column(DataType.INTEGER)
  block_number: number;

  @Column(DataType.STRING)
  block_time: string;

  @Column(DataType.INTEGER)
  block_timestamp: number; // decorated

  @Column(DataType.INTEGER)
  gas_limit: number;

  @Column(DataType.INTEGER)
  gas_used: number;

  @Column(DataType.INTEGER)
  index: number;

  @Column(DataType.INTEGER)
  l1_block_number: number;

  @Column(DataType.DECIMAL)
  l1_fee: string;

  @Column(DataType.DECIMAL)
  l1_gas_price: string;

  @Column(DataType.DECIMAL)
  l1_gas_used: string;

  @Column(DataType.DECIMAL)
  l1_timestamp: string;

  @Column(DataType.DECIMAL)
  max_fee_per_gas: string;

  @Column(DataType.DECIMAL)
  max_priority_fee_per_gas: string;

  @Column(DataType.DECIMAL)
  nonce: number;

  @Column(DataType.DECIMAL)
  priority_fee_per_gas: string;

  @Column(DataType.BOOLEAN)
  success: boolean;

  @Column(DataType.STRING)
  type: string;

  @Column(DataType.STRING)
  block_date: string;
}
