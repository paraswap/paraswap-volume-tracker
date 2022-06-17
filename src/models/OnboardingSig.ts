import {
  Table,
  Model,
  Column,
  DataType,
  Index,
  Unique,
} from 'sequelize-typescript';
import { RegisteredAddressWithSig } from '../lib/onboarding/types';
import { DataType_ADDRESS, DataType_SIG } from '../lib/sql-data-types';

/// FALLBACK ONLY
@Table
export class OnboardingSig extends Model<RegisteredAddressWithSig> {
  @Index
  @Unique
  @Column(DataType_ADDRESS)
  address: string;

  @Column(DataType.SMALLINT)
  version: number;

  @Column(DataType_SIG)
  sig: string;
}
