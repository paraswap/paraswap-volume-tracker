import { TransactionRequest } from '@ethersproject/providers';
import { Contract } from '@ethersproject/contracts';
import _ from 'lodash';
import { assert } from 'ts-essentials';
import * as Sequelize from 'sequelize';
import Database from '../database';
import { GasRefundParticipation } from '../models/GasRefundParticipation';
import { GasRefundDistribution } from '../models/GasRefundDistribution';
import { GasRefundTransaction } from '../models/GasRefundTransaction';
import {
  CHAIN_ID_BINANCE,
  CHAIN_ID_FANTOM,
  CHAIN_ID_MAINNET,
  CHAIN_ID_POLYGON,
} from './constants';
import { EpochInfo } from './epoch-info';
import { GasRefundGenesisEpoch, TransactionStatus } from './gas-refund';
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
  [CHAIN_ID_MAINNET]: '0xFEB7e2D8584BEf7BB21dA0B70C148DABf1388031',
  [CHAIN_ID_POLYGON]: '0xD15Fe65BCf0B612343E879434dc72DB1721F732D',
  [CHAIN_ID_FANTOM]: '0xCA82162e3666dbDf97814197Ae82731D857125dE',
  [CHAIN_ID_BINANCE]: '0x8fdcdAc765128F2A5CB2EB7Ed8990B2B24Cb66d7',
};

interface GasRefundClaim
  extends Pick<GasRefundParticipation, 'epoch' | 'address' | 'merkleProofs'> {
  refundedAmountPSP: string;
}

type BaseGasRefundClaimsResponse<T> = {
  totalClaimable: T;
  claims: (Omit<GasRefundClaim, 'refundedAmountPSP'> & { amount: string })[];
};
type GasRefundClaimsResponseAcc = BaseGasRefundClaimsResponse<bigint>;
type GasRefundClaimsResponse = BaseGasRefundClaimsResponse<string> & {
  pendingClaimable: string;
};

export class GasRefundApi {
  epochInfo: EpochInfo;
  merkleRedem: MerkleRedeem;

  static instances: { [network: number]: GasRefundApi } = {};

  constructor(protected network: number) {
    this.epochInfo = EpochInfo.getInstance(CHAIN_ID_MAINNET);
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
  async gasRefundDataForEpoch(epoch: number): Promise<{
    data: GasRefundDistribution;
    txParams: TransactionRequest;
  } | null> {
    const data = await GasRefundDistribution.findOne({
      where: { chainId: this.network, epoch },
      attributes: ['merkleRoot', 'epoch', 'chainId', 'totalPSPAmountToRefund'],
      raw: true,
    });

    if (!data) return null;

    const { merkleRoot, totalPSPAmountToRefund } = data;

    const txData = this.merkleRedem.interface.encodeFunctionData(
      'seedAllocations',
      [epoch, merkleRoot, totalPSPAmountToRefund],
    );

    return {
      data,
      txParams: {
        to: MerkleRedeemAddress[this.network],
        data: txData,
        chainId: this.network,
      },
    };
  }

  async _fetchMerkleData(address: string): Promise<GasRefundClaim[]> {
    const sqlQuery = `
        SELECT  grp.address, grp.epoch, grp."merkleProofs", refunds."refundedAmountPSP"
        FROM "GasRefundParticipations" grp
        JOIN (
          SELECT grt."address", grt.epoch, SUM(grt."refundedAmountPSP") AS "refundedAmountPSP"
          FROM "GasRefundTransactions" grt
          WHERE grt."chainId" = :chainId and status='validated'
          GROUP BY grt.address, grt.epoch
        ) AS refunds ON grp.address = refunds.address and grp.epoch = refunds.epoch
        WHERE grp.address=:address AND grp."chainId"=:chainId
    `;
    const grpDataResult: GasRefundClaim[] = await Database.sequelize.query(
      sqlQuery,
      {
        type: Sequelize.QueryTypes.SELECT,
        replacements: {
          address,
          chainId: this.network,
        },
      },
    );

    return grpDataResult;
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

  async _getCurrentEpochPendingRefundedAmount(
    address: string,
  ): Promise<string> {
    const epoch = await this.epochInfo.getCurrentEpoch();

    const totalPSPRefunded = await GasRefundTransaction.sum<
      string,
      GasRefundTransaction
    >('refundedAmountPSP', {
      where: {
        address,
        epoch,
        status: TransactionStatus.VALIDATED,
        chainId: this.network,
      },
    });

    const refundedAmount = totalPSPRefunded.toString(10);

    return refundedAmount;
  }

  // get all ever constructed merkle data for addrress
  async getAllGasRefundDataForAddress(
    address: string,
  ): Promise<GasRefundClaimsResponse> {
    const lastEpoch = (await this.epochInfo.getCurrentEpoch()) - 1;

    const startEpoch = GasRefundGenesisEpoch;
    const endEpoch = Math.max(lastEpoch, GasRefundGenesisEpoch);

    const [merkleData, epochToClaimed, pendingClaimable] = await Promise.all([
      this._fetchMerkleData(address),
      this._getClaimStatus(address, startEpoch, endEpoch),
      this._getCurrentEpochPendingRefundedAmount(address),
    ]);

    const { totalClaimable, claims } =
      merkleData.reduce<GasRefundClaimsResponseAcc>(
        (acc, claim) => {
          if (epochToClaimed[claim.epoch]) return acc;

          const { refundedAmountPSP, ...rClaim } = claim;
          acc.claims.push({ ...rClaim, amount: refundedAmountPSP });
          acc.totalClaimable += BigInt(refundedAmountPSP);

          return acc;
        },
        {
          totalClaimable: BigInt(0),
          claims: [],
        },
      );

    return {
      totalClaimable: totalClaimable.toString(),
      claims,
      pendingClaimable,
    };
  }

  async getAllEntriesForEpoch(
    epoch: number,
  ): Promise<GasRefundParticipation[]> {
    const grpData = await GasRefundParticipation.findAll({
      where: { epoch, chainId: this.network },
      raw: true,
    });

    return grpData;
  }
}
