// import GasRefundModel from '../models/GasRefund';
import { TransactionRequest } from '@ethersproject/providers';
import { Contract } from 'ethers';
import _ from 'lodash';
import { assert } from 'ts-essentials';
import { getMerkleTree } from '../service/transaction-fees-indexer/persistance';
import {
  MerkleData,
  MerkleRoot,
} from '../service/transaction-fees-indexer/types';
import {
  CHAIN_ID_BINANCE,
  CHAIN_ID_FANTOM,
  CHAIN_ID_MAINNET,
  CHAIN_ID_POLYGON,
} from './constants';
import { EpochInfo } from './epoch-info';
import { Provider } from './provider';

const MerkleRedeemAbi = [
  'function seedAllocations(uint _week, bytes32 _merkleRoot, uint _totalAllocation)',
  'function claimStatus(address _liquidityProvider, uint _begin, uint _end) external view returns (bool[] memory)',
];

interface MerkleRedeem extends Contract {
  callStatic: {
    claimStatus(
      _liquidityProvider: string,
      _begin: number,
      _end: number,
    ): Promise<boolean[]>;
  };
}

const MerkleRedeemAddress: { [chainId: number]: string } = {
  // @TODO
  [CHAIN_ID_MAINNET]: '0x',
  [CHAIN_ID_POLYGON]: '0xe4aa70d4b77533000dc51bc4b98f26f4ee1aaea4', // @FIXME
  [CHAIN_ID_FANTOM]: '0x',
  [CHAIN_ID_BINANCE]: '0x',
};

const GasRefundGenesisEpoch = 8; // @FIXME

export class GasRefundApi {
  epochInfo: EpochInfo;
  merkleRedem: MerkleRedeem;
  // gasRefundModel: GasRefundModel;

  static instances: { [network: number]: GasRefundApi } = {};

  constructor(protected network: number) {
    this.epochInfo = EpochInfo.getInstance(CHAIN_ID_MAINNET);
    // this.gasRefundModel = new GasRefundModel(network);
    this.merkleRedem = new Contract(
      MerkleRedeemAddress[network],
      MerkleRedeemAbi,
      Provider.getJsonRpcProvider(this.network),
    ) as unknown as MerkleRedeem;
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

    const txData = this.merkleRedem.interface.encodeFunctionData(
      'seedAllocations',
      [lastEpochNum, root.merkleRoot, root.totalAmount],
    );

    return {
      root,
      txParams: {
        to: '0x',
        data: txData,
        chainId: this.network,
      },
    };
  }

  async _fetchMerkleData(
    address: string,
    startEpoch: number,
    endEpoch: number,
  ): Promise<MerkleData[]> {
    const epochs =
      startEpoch === endEpoch
        ? [GasRefundGenesisEpoch]
        : _.range(startEpoch, endEpoch + 1);

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

  async _getClaimStatus(
    address: string,
    startEpoch: number,
    endEpoch: number,
  ): Promise<Record<number, boolean>> {
    const claimStatus = await this.merkleRedem.callStatic.claimStatus(
      address,
      startEpoch,
      endEpoch,
    );

    const epochToClaimed = claimStatus.reduce<Record<number, boolean>>(
      (acc, claimed, index) => {
        acc[startEpoch + index] = claimed;
        return acc;
      },
      {},
    );

    assert(
      Object.keys(epochToClaimed).length == endEpoch - startEpoch + 1,
      'logic error',
    );

    return epochToClaimed;
  }

  // get all ever constructed merkle data for addrress
  async getMerkleDataForAddress(address: string): Promise<MerkleData[] | null> {
    const lastEpoch = (await this.epochInfo.getCurrentEpoch()) - 1;

    const startEpoch = GasRefundGenesisEpoch;
    const endEpoch = Math.max(lastEpoch, GasRefundGenesisEpoch);

    const [merkleData, epochToClaimed] = await Promise.all([
      this._fetchMerkleData(address, startEpoch, endEpoch),
      this._getClaimStatus(address, startEpoch, endEpoch),
    ]);

    return merkleData.filter(m => !epochToClaimed[m.epoch]);
  }
}
