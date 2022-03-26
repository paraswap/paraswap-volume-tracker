import { Table } from 'sequelize-typescript';
import {
  MerkleData,
  MerkleRoot,
} from './types';

export class GasRefundModel {
  static instances: { [network: number]: GasRefundModel } = {};

  constructor(protected network: number) {}

  static getInstance(network: number): GasRefundModel {
    if (!this.instances[network]) {
      this.instances[network] = new GasRefundModel(network);
    }
    return this.instances[network];
  }

  async getMerkleRootForPeriod(
    startTimestamp: number,
    endTimestamp: number,
  ): Promise<MerkleRoot[] | null> {
    return null; // @TODO: retrieve from file or database
  }

  async getMerkleDataForAddress(address: string): Promise<MerkleData[] | null> {
    return null; // @TODO: retrieve from file or database
  }
}
