import { Table, Model, Column, DataType, AllowNull, PrimaryKey } from 'sequelize-typescript';
import { DataType_ADDRESS } from '../lib/sql-data-types';

export interface ClaimAttributes {
  userAddress: string;
  claim: object;
}

@Table({ timestamps: false })
export class Claim extends Model<ClaimAttributes> {
  @PrimaryKey
  @Column(DataType_ADDRESS)
  userAddress: string;

  @AllowNull(false)
  @Column(DataType.JSONB)
  claim: object;
}
