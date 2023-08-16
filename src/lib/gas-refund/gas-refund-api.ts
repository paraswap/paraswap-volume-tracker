import { TransactionRequest } from '@ethersproject/providers';
import { Contract } from '@ethersproject/contracts';
import _ from 'lodash';
import { assert } from 'ts-essentials';
import * as Sequelize from 'sequelize';
import Database from '../../database';
import { GasRefundParticipation } from '../../models/GasRefundParticipation';
import { GasRefundDistribution } from '../../models/GasRefundDistribution';
import {
  CHAIN_ID_BINANCE,
  CHAIN_ID_FANTOM,
  CHAIN_ID_GOERLI,
  CHAIN_ID_MAINNET,
  CHAIN_ID_OPTIMISM,
  CHAIN_ID_POLYGON,
} from '../constants';
import { GasRefundGenesisEpoch, GasRefundV2EpochFlip } from './gas-refund';
import { Provider } from '../provider';
import * as MerkleRedeemAbi from '../abi/merkle-redeem.abi.json';
import {
  sePSPMigrations,
  SePSPMigrationsData,
} from '../../models/sePSPMigrations';
import { getCurrentEpoch } from './epoch-helpers';

interface MerkleRedeem extends Contract {
  callStatic: {
    claimStatus(
      _liquidityProvider: string,
      _begin: number,
      _end: number,
    ): Promise<boolean[]>;
  };
}

// FIXME merkle redeem address
const MerkleRedeemAddress: { [chainId: number]: string } = {
  [CHAIN_ID_MAINNET]: '0xFEB7e2D8584BEf7BB21dA0B70C148DABf1388031',
  [CHAIN_ID_GOERLI]: '0xFEB7e2D8584BEf7BB21dA0B70C148DABf1388031', // mainnet addr used as placeholder
  [CHAIN_ID_OPTIMISM]: '0xeA6cC6949c1DF315Af93aB82D567A8FCEe41016d',
  [CHAIN_ID_POLYGON]: '0xD15Fe65BCf0B612343E879434dc72DB1721F732D',
  [CHAIN_ID_FANTOM]: '0xCA82162e3666dbDf97814197Ae82731D857125dE',
  [CHAIN_ID_BINANCE]: '0x8fdcdAc765128F2A5CB2EB7Ed8990B2B24Cb66d7',
};

export const MerkleRedeemAddressSePSP1: { [chainId: number]: string } = {
  [CHAIN_ID_MAINNET]: '0x0ecb7de52096638c01757180c88b74e4474473ab',
  [CHAIN_ID_OPTIMISM]: '0xeA6cC6949c1DF315Af93aB82D567A8FCEe41016d',
};

export const EPOCH_WHEN_SWITCHED_TO_SE_PSP1 = 32;

const MERKLE_DATA_SQL_QUERY = `
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

interface GasRefundClaim
  extends Pick<GasRefundParticipation, 'epoch' | 'address' | 'merkleProofs'> {
  refundedAmountPSP: string;
}

const PENDING_DATA_SQL_QUERY = `
  SELECT epoch as "epoch1", sum("refundedAmountPSP") as "totalPendingForEpoch"
  FROM public."GasRefundTransactions"
  WHERE epoch > :latestEpochRefunded AND address = :address AND status='validated' AND "chainId" = :chainId
  GROUP BY epoch
  ORDER BY epoch ASC
`;

type PendingRefundRawData = {
  epoch1: number;
  totalPendingForEpoch: string;
};

type PendingRefundData = PendingRefundRawData & { epoch2: number };

type BaseGasRefundClaimsResponse<T> = {
  totalClaimable: T;
  claims: (Omit<GasRefundClaim, 'refundedAmountPSP'> & {
    amount: string;
    contract: string;
  })[];
};
type GasRefundClaimsResponseAcc = BaseGasRefundClaimsResponse<bigint>;
type GasRefundClaimsResponse = BaseGasRefundClaimsResponse<string> & {
  pendingClaimable: string;
  pendingRefundBreakdownPerEpoch: PendingRefundData[];
  txParams?: {
    to: string;
    data: string | null;
    chainId: number;
  };
};

type MigrationData =
  | {
      hasMigrated: false;
    }
  | ({
      hasMigrated: true;
    } & SePSPMigrationsData);

export class GasRefundApi {
  merkleRedem: MerkleRedeem;
  merkleRedemSePSP1?: MerkleRedeem;

  static instances: { [network: number]: GasRefundApi } = {};

  constructor(protected network: number) {
    this.merkleRedem = new Contract(
      MerkleRedeemAddress[network],
      MerkleRedeemAbi,
      Provider.getJsonRpcProvider(this.network),
    ) as unknown as MerkleRedeem;
    if (network === CHAIN_ID_MAINNET || network === CHAIN_ID_OPTIMISM) {
      this.merkleRedemSePSP1 = new Contract(
        MerkleRedeemAddressSePSP1[network],
        MerkleRedeemAbi,
        Provider.getJsonRpcProvider(this.network),
      ) as unknown as MerkleRedeem;
    }
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
    const grpDataResult: GasRefundClaim[] = await Database.sequelize.query(
      MERKLE_DATA_SQL_QUERY,
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
    if (this.network === CHAIN_ID_GOERLI || this.network === CHAIN_ID_OPTIMISM) return {};
    const [claimStatusPSP, claimStatusSePSP1] = await Promise.all([
      this.merkleRedem.callStatic.claimStatus(address, startEpoch, endEpoch),
      this.merkleRedemSePSP1?.callStatic.claimStatus(
        address,
        startEpoch,
        endEpoch,
      ) || [],
    ]);

    let epochToClaimed: Record<string, boolean> = {};

    for (let i = 0; i < endEpoch - startEpoch + 1; i++) {
      epochToClaimed[startEpoch + i] = Boolean(
        claimStatusPSP[i] || claimStatusSePSP1[i],
      );
    }

    assert(
      Object.keys(epochToClaimed).length == endEpoch - startEpoch + 1,
      'logic error',
    );

    return epochToClaimed;
  }

  async _getCurrentEpochPendingRefundedAmount(address: string): Promise<{
    totalPendingRefundAmount: string;
    pendingRefundBreakdownPerEpoch: PendingRefundData[];
  }> {
    const latestEpochRefunded = await GasRefundDistribution.max<
      number,
      GasRefundDistribution
    >('epoch', {
      where: {
        chainId: this.network,
      },
    });

    const rawPendingData: PendingRefundRawData[] =
      await Database.sequelize.query(PENDING_DATA_SQL_QUERY, {
        type: Sequelize.QueryTypes.SELECT,
        replacements: {
          address,
          chainId: this.network,
          latestEpochRefunded,
        },
      });

    const { totalPendingRefundAmount, pendingRefundBreakdownPerEpoch } =
      rawPendingData.reduce<{
        totalPendingRefundAmount: bigint;
        pendingRefundBreakdownPerEpoch: PendingRefundData[];
      }>(
        (acc, curr) => {
          const epoch2 = curr.epoch1 - GasRefundV2EpochFlip;

          acc.totalPendingRefundAmount += BigInt(curr.totalPendingForEpoch);
          acc.pendingRefundBreakdownPerEpoch.push({
            ...curr,
            epoch2,
          });

          return acc;
        },
        {
          totalPendingRefundAmount: BigInt(0),
          pendingRefundBreakdownPerEpoch: [],
        },
      );

    return {
      totalPendingRefundAmount: totalPendingRefundAmount.toString(),
      pendingRefundBreakdownPerEpoch,
    };
  }

  // get all ever constructed merkle data for addrress
  async getAllGasRefundDataForAddress(
    address: string,
  ): Promise<GasRefundClaimsResponse> {
    const lastEpoch = getCurrentEpoch() - 1;

    const startEpoch = GasRefundGenesisEpoch;
    const endEpoch = Math.max(lastEpoch, GasRefundGenesisEpoch);

    const [
      merkleData,
      epochToClaimed,
      { totalPendingRefundAmount, pendingRefundBreakdownPerEpoch },
    ] = await Promise.all([
      this._fetchMerkleData(address),
      this._getClaimStatus(address, startEpoch, endEpoch),
      this._getCurrentEpochPendingRefundedAmount(address),
    ]);

    const { totalClaimable, claims } =
      merkleData.reduce<GasRefundClaimsResponseAcc>(
        (acc, claim) => {
          if (epochToClaimed[claim.epoch]) return acc;

          const { refundedAmountPSP, ...rClaim } = claim;

          const shouldSwitchToSePSP1Contract =
            this.network === CHAIN_ID_MAINNET &&
            claim.epoch >= EPOCH_WHEN_SWITCHED_TO_SE_PSP1;
          const contract = shouldSwitchToSePSP1Contract
            ? MerkleRedeemAddressSePSP1[this.network]
            : MerkleRedeemAddress[this.network];
          acc.claims.push({ ...rClaim, amount: refundedAmountPSP, contract });
          acc.totalClaimable += BigInt(refundedAmountPSP);

          return acc;
        },
        {
          totalClaimable: BigInt(0),
          claims: [],
        },
      );

    const data = !claims.length
      ? null
      : claims.length == 1
      ? this.merkleRedem.interface.encodeFunctionData('claimWeek', [
          address,
          claims[0].epoch,
          claims[0].amount,
          claims[0].merkleProofs,
        ])
      : this.merkleRedem.interface.encodeFunctionData('claimWeeks', [
          address,
          claims.map(({ epoch, merkleProofs, amount }) => ({
            week: epoch,
            balance: amount,
            merkleProof: merkleProofs,
          })),
        ]);

    return {
      totalClaimable: totalClaimable.toString(),
      claims,
      pendingClaimable: totalPendingRefundAmount.toString(),
      pendingRefundBreakdownPerEpoch,
      // txParams: {
      //   to: this.merkleRedem.address,
      //   data,
      //   chainId: this.network,
      // },
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

  async getMigrationData(
    _account: string,
    chainId: number,
  ): Promise<MigrationData> {
    const account = _account.toLowerCase();
    const migrations = await sePSPMigrations.findAll({
      where: { account, chainId },
      raw: true,
    });

    assert(
      migrations.length <= 1,
      'logic error should only track at most one migration',
    );

    const migration = migrations[0];

    if (!migration) {
      return {
        hasMigrated: false,
      };
    }

    return {
      ...migration,
      hasMigrated: true,
    };
  }
}
