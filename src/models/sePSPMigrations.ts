import {
  Model,
  Table,
  Column,
  DataType,
  createIndexDecorator,
} from 'sequelize-typescript';
import {
  DataType_ADDRESS,
  DataType_KECCAK256_HASHED_VALUE,
} from '../lib/sql-data-types';

const CompositeUniq = createIndexDecorator({
  name: 'se_psp_migrations_acc_chain_uniq',
  type: 'UNIQUE',
  unique: true,
});

export type SePSPMigrationsData = {
  account: string;
  chainId: number;
  epoch: number;
  txHash: string;
};

@Table
export class sePSPMigrations extends Model<SePSPMigrationsData> {
  @CompositeUniq
  @Column(DataType_ADDRESS)
  account!: string;

  @CompositeUniq
  @Column(DataType.INTEGER)
  chainId!: number;

  @Column(DataType.SMALLINT)
  epoch!: number;

  @Column(DataType_KECCAK256_HASHED_VALUE)
  txHash!: string;
}
