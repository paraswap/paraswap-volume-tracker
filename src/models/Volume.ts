import { Table, Model, Column, Index, AllowNull, PrimaryKey, Default, DataType, Scopes } from 'sequelize-typescript'
import {
  DataType_ADDRESS,
  DataType_UINT256,
  DataType_USD_VALUE,
  DataType_HALF_STRING,
} from '../lib/sql-data-types';

export interface VolumeAttributes {
  id: string;
  network: number;
  blockNumber: number;
  timestamp: number;
  makerAddress: string;
  takerAddress: string;
  fromToken: string;
  toToken: string;
  fromVolume: string;
  fromVolumeUSD: string;
  toVolume: string;
  toVolumeUSD: string;
  isWhitelisted: boolean;
}

@Scopes(() => ({
  whitelisted: {
    where: {
      isWhitelisted: true
    }
  },
}))
@Table
export class Volume extends Model<VolumeAttributes> {
  @PrimaryKey
  @Column(DataType_HALF_STRING)
  id: string;

  @Index('volume_network_blocknumber')
  @Index('volume_network_timestamp')
  @AllowNull(false)
  @Column
  network: number;

  @Index('volume_network_blocknumber')
  @AllowNull(false)
  @Column
  blockNumber: number;

  @Index('volume_network_timestamp')
  @AllowNull(false)
  @Column
  timestamp: number;

  @AllowNull(false)
  @Column(DataType_ADDRESS)
  makerAddress: string

  @AllowNull(false)
  @Column(DataType_ADDRESS)
  takerAddress: string

  @AllowNull(false)
  @Column(DataType_ADDRESS)
  fromToken: string;

  @AllowNull(false)
  @Column(DataType_ADDRESS)
  toToken: string;

  @AllowNull(false)
  @Column(DataType_UINT256)
  fromVolume: string;

  @AllowNull(false)
  @Column(DataType_USD_VALUE)
  fromVolumeUSD: string;

  @AllowNull(false)
  @Column(DataType_UINT256)
  toVolume: string;

  @AllowNull(false)
  @Column(DataType_USD_VALUE)
  toVolumeUSD: string;

  @AllowNull(false)
  @Default(false)
  @Column
  isWhitelisted: boolean;
}
