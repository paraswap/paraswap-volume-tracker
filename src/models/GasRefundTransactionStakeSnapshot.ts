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


export interface GasRefundTransactionStakeSnapshotData {
  transactionChainId: number;
  transactionHash: string;
  staker: string;
  stakeChainId: number;
  stakeScore: string; // should be computed by JS, not by SQL
  sePSP1Balance: string;
  sePSP2Balance: string;
  bptTotalSupply: string;
  bptPSPBalance: string;
  claimableSePSP1Balance: string;
}

const compositeIndex = createIndexDecorator({
  name: 'txChain_txHash_staker_stakeChain',
  type: 'UNIQUE',
  unique: true,
});

@Table
export class GasRefundTransactionStakeSnapshot extends Model<GasRefundTransactionStakeSnapshotData> {
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
  sePSP1Balance: string;

  @Column(DataType.DECIMAL)
  sePSP2Balance: string;

  @Column(DataType.DECIMAL)
  bptTotalSupply: string;

  @Column(DataType.DECIMAL)
  bptPSPBalance: string;

  @Column(DataType.DECIMAL)
  claimableSePSP1Balance: string;
}
