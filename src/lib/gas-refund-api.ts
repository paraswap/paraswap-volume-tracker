import { GasRefundModel } from '../models/GasRefund';
import {
  MerkleData,
  MerkleRoot,
} from '../service/transaction-fees-indexer/types';
import { CHAIN_ID_MAINNET } from './constants';
import { EpochInfo } from './epoch-info';

export class GasRefundApi {
  epochInfo: EpochInfo;
  gasRefundModel: GasRefundModel;

  static instances: { [network: number]: GasRefundApi } = {};

  constructor(protected network: number) {
    this.epochInfo = new EpochInfo(CHAIN_ID_MAINNET);
    this.gasRefundModel = new GasRefundModel(network);
  }

  static getInstance(network: number): GasRefundApi {
    if (!this.instances[network])
      this.instances[network] = new GasRefundApi(network);
    return this.instances[network];
  }

  // retrieve all merkle roots matching period
  async getMerkleRootForPeriod(
    startTimestamp: number,
    endTimestamp: number,
  ): Promise<MerkleRoot[] | null> {
    return this.gasRefundModel.getMerkleRootForPeriod(
      startTimestamp,
      endTimestamp,
    );
  }


  // retrieve merkle root + compute tx params
  async getMerkleRootForLastEpoch(): Promise<MerkleRoot | null> {
    const currentEpochNum = await this.epochInfo.getCurrentEpoch();
    const lastEpochNum = currentEpochNum - 1;
    const [epochStartTime, epochEndtime] = await Promise.all([
      this.epochInfo.getEpochStartCalcTime(lastEpochNum),
      this.epochInfo.getEpochEndCalcTime(lastEpochNum),
    ]);

    if (!epochStartTime || !epochEndtime) throw new Error('no last epoch'); // FIXME: check case when epochEndTime would be in the future

    const merkleRootPeriod = await this.getMerkleRootForPeriod(
      epochStartTime,
      epochEndtime,
    );

    if (!merkleRootPeriod) return null;

    if (merkleRootPeriod.length !== 1)
      throw new Error(
        'logic error: can only be exactly one merkle root per epoch',
      );

      // TODO: compute MerkleRedeem.seedAllocations() tx params

    return merkleRootPeriod[0];
  }

  // get all merkle data for address between 2 arbitrary dates
  // Note: this returns all merkle data generated ever, it's up to frontend to filter already claimed epochs
  async getMerkleDataForAddress(address: string): Promise<MerkleData[] | null> {
    return this.gasRefundModel.getMerkleDataForAddress(address);
  }
}
