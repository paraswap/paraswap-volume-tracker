import {
  Model,
  Column,
  DataType,
  createIndexDecorator,
  Table,
} from 'sequelize-typescript';
import {
  DataType_ADDRESS,
  DataType_KECCAK256_HASHED_VALUE,
} from '../lib/sql-data-types';
import { GasRefundTransactionStakeSnapshotData } from './GasRefundTransactionStakeSnapshot';

export interface GasRefundTransactionStakeSnapshotData_V3 {
  transactionChainId: number;
  transactionHash: string;
  staker: string;
  stakeChainId: number;
  stakeScore: string; // should be computed by JS, not by SQL
  seXYZBalance: string;
  bptTotalSupply: string;
  bptXYZBalance: string;  
}

export function isGasRefundTransactionStakeSnapshotData_V3(input: GasRefundTransactionStakeSnapshotData_V3 | GasRefundTransactionStakeSnapshotData){
  return 'seXYZBalance' in input;
}

export function isGasRefundTransactionStakeSnapshotData_V3_Arr(input: (GasRefundTransactionStakeSnapshotData_V3 | GasRefundTransactionStakeSnapshotData)[]): input is GasRefundTransactionStakeSnapshotData_V3[] {
  return isGasRefundTransactionStakeSnapshotData_V3(input[0]);
}

export function isGasRefundTransactionStakeSnapshotData_V2_Arr(input: (GasRefundTransactionStakeSnapshotData_V3 | GasRefundTransactionStakeSnapshotData)[]): input is GasRefundTransactionStakeSnapshotData[] {
  return isGasRefundTransactionStakeSnapshotData_V3(input[0]);
}

const compositeIndex = createIndexDecorator({
  name: 'txChain_txHash_staker_stakeChain_v3',
  type: 'UNIQUE',
  unique: true,
});

@Table
export class GasRefundTransactionStakeSnapshot_V3 extends Model<GasRefundTransactionStakeSnapshotData_V3> {
  @compositeIndex
  @Column(DataType.INTEGER)
  transactionChainId: number;

  @compositeIndex
  @Column(DataType_KECCAK256_HASHED_VALUE)
  transactionHash: string;

  @compositeIndex
  @Column(DataType_ADDRESS)
  staker: string;

  @compositeIndex
  @Column(DataType.INTEGER)
  stakeChainId: number;

  @Column(DataType.DECIMAL)
  stakeScore: string; // should be computed by JS, not by SQL  

  @Column(DataType.DECIMAL)
  seXYZBalance: string;

  @Column(DataType.DECIMAL)
  bptTotalSupply: string;

  @Column(DataType.DECIMAL)
  bptXYZBalance: string;  
}
