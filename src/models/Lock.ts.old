import { Table, Model, Column, DataType, Unique } from 'sequelize-typescript';

export type LockProps = { key: string };

@Table
export class Lock extends Model<LockProps> {
  @Unique
  @Column(DataType.STRING)
  key: string;
}
