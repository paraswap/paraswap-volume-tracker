import { Optional } from 'sequelize';
import { Table, Model, PrimaryKey, Column } from 'sequelize-typescript';

export interface VolumeSyncStatusAttributes {
  network: number;
  fromBlockNumber: number;
  toBlockNumber: number;
}

export interface VolumeSyncStatusCreationAttributes extends Optional<VolumeSyncStatusAttributes, 'fromBlockNumber' | 'toBlockNumber'> {}

@Table
export class VolumeSyncStatus extends Model<VolumeSyncStatusAttributes, VolumeSyncStatusCreationAttributes> {
  @PrimaryKey
  @Column
  network: number;

  @Column
  fromBlockNumber: number;

  @Column
  toBlockNumber: number;
}
