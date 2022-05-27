import { SAFETY_MODULE_ADDRESS } from '../constants';
import { SPSPHelper } from './spsp-helper';
import { SafetyModuleHelper } from './safety-module-helper';
import { assert } from 'ts-essentials';
import { PSPStakesAllStakers, PSPStakesForStaker } from './types';

export class StakingService {
  static instance: StakingService;

  static getInstance() {
    if (!this.instance) {
      this.instance = new StakingService();
    }
    return this.instance;
  }

  getPSPStakesAllPrograms = async (
    account: string,
  ): Promise<PSPStakesForStaker<string>> => {
    const [totalPSPStakedInSPSP, totalPSPStakedInSafetyModule] =
      await Promise.all([
        SPSPHelper.getInstance().getPSPStakedInSPSPs(account),
        SafetyModuleHelper.getInstance().getPSPStakedInSafetyModule(account),
      ]);

    return {
      totalPSPStaked: (
        totalPSPStakedInSPSP + totalPSPStakedInSafetyModule
      ).toString(),

      descr: {
        totalPSPStakedInSPSP: totalPSPStakedInSPSP.toString(),
        totalPSPStakedInSafetyModule: totalPSPStakedInSafetyModule.toString(),
      },
    };
  };

  getAllPSPStakersAllPrograms = async (
    blockNumber?: number,
  ): Promise<{
    totalPSPStaked: string;
    totalPSPStakedSPSP: string;
    totalPSPStakedStkPSPBPt: string;
    pspStakersWithStake: PSPStakesAllStakers<string>;
  }> => {
    const [sPSPStakers, stkPSPBPtStakers] = await Promise.all([
      SPSPHelper.getInstance().fetchPSPStakedInSPSP(blockNumber),
      SafetyModuleHelper.getInstance().fetchPSPStakedInStkPSPBpt(blockNumber),
    ]);

    const pspStakersWithStakes: PSPStakesAllStakers<bigint> = {};
    let totalPSPStaked = BigInt(0);
    let totalPSPStakedSPSP = BigInt(0);
    let totalPSPStakedStkPSPBPt = BigInt(0);

    Object.entries(sPSPStakers.stakesByAccount).forEach(
      ([account, pspStakedInSPSP]) => {
        if (!pspStakedInSPSP.totalPSPStakedAllSPSPS) return;
        if (!pspStakersWithStakes[account]?.pspStaked) {
          pspStakersWithStakes[account] = {
            pspStaked: BigInt(0),
            breakdownByStakingContract: {},
          };
        }

        const stake = BigInt(pspStakedInSPSP.totalPSPStakedAllSPSPS);
        pspStakersWithStakes[account].pspStaked += stake;

        totalPSPStaked += stake;
        totalPSPStakedSPSP += stake;

        // description
        if (!pspStakersWithStakes[account].breakdownByStakingContract) {
          pspStakersWithStakes[account].breakdownByStakingContract = {};
        }
        pspStakersWithStakes[account].breakdownByStakingContract = {
          ...pspStakersWithStakes[account].breakdownByStakingContract,
          ...pspStakedInSPSP.descr.totalPSPStakedBySPSP,
        };
      },
    );

    Object.entries(stkPSPBPtStakers).forEach(
      ([account, pspStakedInStkPSPBPt]) => {
        if (!pspStakedInStkPSPBPt) return;
        if (!pspStakersWithStakes[account]?.pspStaked) {
          pspStakersWithStakes[account] = {
            pspStaked: BigInt(0),
            breakdownByStakingContract: {},
          };
        }

        pspStakersWithStakes[account].pspStaked += pspStakedInStkPSPBPt;
        totalPSPStaked += pspStakedInStkPSPBPt;
        totalPSPStakedStkPSPBPt += pspStakedInStkPSPBPt;

        // description
        if (!pspStakersWithStakes[account].breakdownByStakingContract) {
          pspStakersWithStakes[account].breakdownByStakingContract = {};
        }
        pspStakersWithStakes[account].breakdownByStakingContract = {
          ...pspStakersWithStakes[account].breakdownByStakingContract,
          [SAFETY_MODULE_ADDRESS]: pspStakedInStkPSPBPt.toString(),
        };
      },
    );

    const pspStakersWithStakesSer = Object.fromEntries(
      Object.entries(pspStakersWithStakes).map(([account, stake]) => {
        assert(
          account === account.toLowerCase(),
          'account be lowercased already',
        );
        return [
          account,
          {
            ...stake,
            pspStaked: stake.pspStaked.toString(),
          },
        ];
      }),
    );

    return {
      totalPSPStaked: totalPSPStaked.toString(),
      totalPSPStakedSPSP: totalPSPStakedSPSP.toString(),
      totalPSPStakedStkPSPBPt: totalPSPStakedStkPSPBPt.toString(),
      pspStakersWithStake: pspStakersWithStakesSer,
    };
  };
}
