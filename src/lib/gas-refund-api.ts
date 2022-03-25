// import GasRefundModel from '../models/GasRefund';
import { Interface } from '@ethersproject/abi';
import {
  TransactionRequest,
  TransactionResponse,
} from '@ethersproject/providers';
import _ from 'lodash';
import { getMerkleTree } from '../service/transaction-fees-indexer/persistance';
import {
  MerkleData,
  MerkleRoot,
} from '../service/transaction-fees-indexer/types';
import { CHAIN_ID_MAINNET } from './constants';
import { EpochInfo } from './epoch-info';

const MerkleRedeemAbi = [
  'function seedAllocations(uint _week, bytes32 _merkleRoot, uint _totalAllocation)',
];

const IfaceMerkleRedeem = new Interface(MerkleRedeemAbi);

const GasRefundGenesisEpoch = 7; // @FIXME

export class GasRefundApi {
  epochInfo: EpochInfo;
  // gasRefundModel: GasRefundModel;

  static instances: { [network: number]: GasRefundApi } = {};

  constructor(protected network: number) {
    this.epochInfo = EpochInfo.getInstance(CHAIN_ID_MAINNET);
    // this.gasRefundModel = new GasRefundModel(network);
  }

  static getInstance(network: number): GasRefundApi {
    if (!this.instances[network])
      this.instances[network] = new GasRefundApi(network);
    return this.instances[network];
  }

  // retrieve merkle root + compute tx params for last epoch
  async getMerkleRootForLastEpoch(): Promise<{
    root: MerkleRoot;
    txParams: TransactionRequest;
  } | null> {
    const currentEpochNum = await this.epochInfo.getCurrentEpoch();
    const lastEpochNum = currentEpochNum - 1;

    const merkleTree = await getMerkleTree({
      chainId: this.network,
      epochNum: lastEpochNum,
    });

    if (!merkleTree) return null;

    const { root } = merkleTree;

    const txData = IfaceMerkleRedeem.encodeFunctionData('seedAllocations', [
      lastEpochNum,
      root.merkleRoot,
      root.totalAmount,
    ]);

    return {
      root,
      txParams: {
        to: '0x',
        data: txData,
        chainId: this.network,
      },
    };
  }

  // get all ever constructed merkle data for addrress
  // @FIXME: filter already claimed
  async getMerkleDataForAddress(address: string): Promise<MerkleData[] | null> {
    const lastEpochNum = (await this.epochInfo.getCurrentEpoch()) - 1;
    
    const epochs =
      lastEpochNum < GasRefundGenesisEpoch
        ? []
        : lastEpochNum === GasRefundGenesisEpoch
        ? [GasRefundGenesisEpoch]
        : _.range(GasRefundGenesisEpoch, lastEpochNum);

    const merkleData = await Promise.all(
      epochs.map(async epochNum => {
        const merkleData = await getMerkleTree({
          chainId: this.network,
          epochNum,
        });

        if (!merkleData) return null;

        const merkleDataEpoch = merkleData.leaves.find(
          l => l.address.toLowerCase() === address.toLowerCase(),
        );

        return merkleDataEpoch;
      }),
    );

    return merkleData.filter(v => !!v) as MerkleData[]; // @fixme types do not work
  }
}
