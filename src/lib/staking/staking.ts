import { CHAIN_ID_MAINNET, SAFETY_MODULE_ADDRESS } from '../constants';
import { SPSPHelper } from './spsp-helper';
import { SafetyModuleHelper } from './safety-module-helper';
import { assert } from 'ts-essentials';
import { PSPStakesByStaker, PSPStakesForStaker } from './types';
import { Provider } from '../provider';

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
    blockNumber?: number,
  ): Promise<PSPStakesForStaker<string>> => {
    const [spsp, safetyModule] = await Promise.all([
      SPSPHelper.getInstance().getPSPStakedInSPSPs(account, blockNumber),
      SafetyModuleHelper.getInstance().getPSPStakedInSafetyModule(
        account,
        blockNumber,
      ),
    ]);

    return {
      pspStaked: (
        BigInt(spsp.pspStaked) + BigInt(safetyModule.pspStaked)
      ).toString(),

      breakdownByStakingContract: {
        ...spsp.breakdownByStakingContract,
        ...safetyModule.breakdownByStakingContract,
      },
    };
  };

  getAllPSPStakersAllPrograms = async (
    _blockNumber?: number,
  ): Promise<{
    blockNumber: number;
    totalPSPStaked: string;
    totalPSPStakedSPSP: string;
    totalPSPStakedStkPSPBpt: string;
    pspStakersWithStake: PSPStakesByStaker<string>;
  }> => {
    const blockNumber =
      _blockNumber ||
      (await Provider.getJsonRpcProvider(CHAIN_ID_MAINNET).getBlockNumber());

    const [sPSPStakers, stkPSPBPtStakers] = await Promise.all([
      SPSPHelper.getInstance().fetchPSPStakedInSPSP(blockNumber),
      SafetyModuleHelper.getInstance().fetchPSPStakedInStkPSPBpt(blockNumber),
    ]);

    const pspStakersWithStakes: PSPStakesByStaker<bigint, string> = {};
    let totalPSPStaked = BigInt(0);
    let totalPSPStakedSPSP = BigInt(0);
    let totalPSPStakedStkPSPBpt = BigInt(0);

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
          ...pspStakedInSPSP.breakdownByStakingContract,
        };
      },
    );

    Object.entries(stkPSPBPtStakers).forEach(
      ([account, _pspStakedInStkPSPBPt]) => {
        if (!_pspStakedInStkPSPBPt) return;
        if (!pspStakersWithStakes[account]?.pspStaked) {
          pspStakersWithStakes[account] = {
            pspStaked: BigInt(0),
            breakdownByStakingContract: {},
          };
        }

        const pspStakedInStkPSPBPt = _pspStakedInStkPSPBPt as bigint;
        pspStakersWithStakes[account].pspStaked += pspStakedInStkPSPBPt;
        totalPSPStaked += pspStakedInStkPSPBPt;
        totalPSPStakedStkPSPBpt += pspStakedInStkPSPBPt;

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
      blockNumber,
      totalPSPStaked: totalPSPStaked.toString(),
      totalPSPStakedSPSP: totalPSPStakedSPSP.toString(),
      totalPSPStakedStkPSPBpt: totalPSPStakedStkPSPBpt.toString(),
      pspStakersWithStake: pspStakersWithStakesSer,
    };
  };
}
