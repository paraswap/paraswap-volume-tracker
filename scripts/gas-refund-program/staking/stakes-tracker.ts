import { assert } from 'ts-essentials';
import {
  OFFSET_CALC_TIME,
  SCRIPT_START_TIME_SEC,
} from '../../../src/lib/gas-refund/common';
import {
  forceStakingChainId,
  grp2CConfigParticularities,
  STAKING_V3_TIMESTAMP,
} from '../../../src/lib/gas-refund/config';
import {
  CHAIN_ID_BASE,
  CHAIN_ID_MAINNET,
  CHAIN_ID_OPTIMISM,
} from '../../../src/lib/constants';
import {
  getCurrentEpoch,
  getEpochStartCalcTime,
} from '../../../src/lib/gas-refund/epoch-helpers';
import {
  GasRefundGenesisEpoch,
  GasRefundSafetyModuleAllPSPInBptFixStartEpoch,
  GasRefundSafetyModuleStartEpoch,
  GasRefundSPSPStakesAlgoFlipEpoch,
  GasRefundV2EpochFlip,
  GasRefundV3EpochFlip,
  GasRefundVirtualLockupStartEpoch,
} from '../../../src/lib/gas-refund/gas-refund';
import { loadEpochToStartFromWithFix } from './2.0/fix';
import { StakeV2Resolver } from './2.0/StakeV2Resolver';
import SafetyModuleStakesTracker from './safety-module-stakes-tracker';
import SPSPStakesTracker from './spsp-stakes-tracker';
import BigNumber from 'bignumber.js';

import {
  GasRefundTransactionStakeSnapshotData,
  GasRefundTransactionStakeSnapshotData_V3,
} from '../../../src/models/GasRefundTransactionStakeSnapshot';
import { StakeV3Resolver } from './2.0/StakeV3Resolver';

export type StakedScoreV2 = {
  combined: BigNumber;
  byNetwork: Record<
    number,
    | Pick<
        GasRefundTransactionStakeSnapshotData,
        | 'bptPSPBalance'
        | 'bptTotalSupply'
        | 'sePSP1Balance'
        | 'sePSP2Balance'
        | 'stakeScore'
        | 'claimableSePSP1Balance'
      >
    | undefined
  >;
};

export type StakedScoreV3 = {
  combined: BigNumber;
  version: 3;
  byNetwork: Record<
    number,
    | Pick<
        GasRefundTransactionStakeSnapshotData_V3,
        'bptXYZBalance' | 'bptTotalSupply' | 'seXYZBalance' | 'stakeScore'
      >
    | undefined
  >;
};

export type StakedScoreV1 = {
  combined: BigNumber;
};

export function isStakeScoreV2(
  stakeScore: StakedScoreV1 | StakedScoreV2 | StakedScoreV3,
): stakeScore is StakedScoreV2 {
  return 'byNetwork' in stakeScore && !('version' in stakeScore);
}

export function isStakeScoreV3(
  stakeScore: StakedScoreV1 | StakedScoreV2 | StakedScoreV3,
): stakeScore is StakedScoreV2 {
  return 'version' in stakeScore && stakeScore.version === 3;
}
export default class StakesTracker {
  chainIds = [forceStakingChainId(CHAIN_ID_MAINNET), CHAIN_ID_OPTIMISM];
  chainIds_V3 = [CHAIN_ID_OPTIMISM, CHAIN_ID_BASE]; // @TODO: add mainnet when time comes

  static instance: StakesTracker;

  static getInstance() {
    if (!this.instance) {
      this.instance = new StakesTracker();
    }
    return this.instance;
  }

  async loadHistoricalStakes(forcedEpoch?: number) {
    // to maintain consistent roots for pre-fix epoch, epochToStartFrom is coupled with that fix
    const { epochToStartFrom: epochToStartFromLoaded } =
      await loadEpochToStartFromWithFix();
    const epochToStartFrom = forcedEpoch || epochToStartFromLoaded;
    console.log('loadHistoricalStakes::epochToStartFrom', epochToStartFrom);

    const endTime = SCRIPT_START_TIME_SEC - OFFSET_CALC_TIME;

    
    // V2
    const epoch = forcedEpoch || getCurrentEpoch();

    // v3
    if (epoch >= GasRefundV3EpochFlip) {
      assert(epochToStartFrom, 'epochToStartFrom should be defined');
      const startTimeStakeV3 = await getEpochStartCalcTime(
        epochToStartFrom
      );

      await Promise.all(
        this.chainIds_V3.map(async chainId =>
          StakeV3Resolver.getInstance(chainId).loadWithinInterval(
            startTimeStakeV3,
            endTime,
          ),
        ),
      );
    }else if (epoch >= GasRefundV2EpochFlip) {
      let startTimeStakeV2 = await getEpochStartCalcTime(
        epochToStartFrom || GasRefundV2EpochFlip,
      );

      await Promise.all(
        this.chainIds.map(async chainId =>
          StakeV2Resolver.getInstance(chainId).loadWithinInterval(
            startTimeStakeV2,
            endTime,
          ),
        ),
      );
    } else {
      // V1
      // Note: since we take start of latest epoch refunded, we don't need adjust start times with VIRTUAL_LOCKUP_PERIOD
      const startTimeSPSP = await getEpochStartCalcTime(
        epochToStartFrom || GasRefundGenesisEpoch,
      );

      const startTimeSM = await getEpochStartCalcTime(
        epochToStartFrom && epochToStartFrom > GasRefundSafetyModuleStartEpoch
          ? epochToStartFrom
          : GasRefundSafetyModuleStartEpoch,
      );

      assert(
        startTimeSPSP < endTime,
        'startTimeSPSP should be less than endTime',
      );
      assert(startTimeSM < endTime, 'startTimeSM should be less than endTime');

      const spspStakesTracker = SPSPStakesTracker.getInstance();
      const stakeModuleStakesTracker = SafetyModuleStakesTracker.getInstance();

      await Promise.all([
        spspStakesTracker.loadHistoricalStakesWithinInterval({
          startTimestamp: startTimeSPSP,
          endTimestamp: endTime,
        }),
        stakeModuleStakesTracker.loadHistoricalStakesWithinInterval({
          startTimestamp: startTimeSM,
          endTimestamp: endTime,
        }),
      ]);
    }
  }

  computeStakeScore(
    _account: string,
    timestamp: number,
    epoch: number,
    eofEpochTimestampForBackwardCompat: number,
  ): StakedScoreV3 | StakedScoreV2 | StakedScoreV1 {
    const account = _account.toLowerCase();

    // v3
    if (epoch >= GasRefundV3EpochFlip) {
      const byNetwork: StakedScoreV3['byNetwork'] = this.chainIds_V3.reduce(
        (acc, chainId) => {
          if (timestamp < STAKING_V3_TIMESTAMP) {
            return acc;
          }

          return {
            ...acc,
            [chainId]: StakeV3Resolver.getInstance(chainId).getStakeForRefund(
              timestamp,
              account,
            ),
          };
        },
        {},
      );

      return {
        combined: Object.values(byNetwork).reduce<BigNumber>(
          (acc, val) => acc.plus(val?.stakeScore || 0),
          new BigNumber(0),
        ),
        byNetwork,
      };
    }

    // V2
    if (epoch >= GasRefundV2EpochFlip) {
      const byNetwork: StakedScoreV2['byNetwork'] = this.chainIds.reduce(
        (acc, chainId) => {
          if (
            grp2CConfigParticularities[chainId]?.stakingStartCalcTimestamp &&
            timestamp <
              grp2CConfigParticularities[chainId]?.stakingStartCalcTimestamp!
          ) {
            return acc;
          }

          return {
            ...acc,
            [chainId]: StakeV2Resolver.getInstance(chainId).getStakeForRefund(
              timestamp,
              account,
            ),
          };
        },
        {},
      );

      return {
        combined: Object.values(byNetwork).reduce<BigNumber>(
          (acc, val) => acc.plus(val?.stakeScore || 0),
          new BigNumber(0),
        ),
        byNetwork,
      };
    }

    // V1
    const spspStakesTracker = SPSPStakesTracker.getInstance();
    const safetyModuleTracker = SafetyModuleStakesTracker.getInstance();

    const pspStakedInSPSP =
      epoch < GasRefundSPSPStakesAlgoFlipEpoch
        ? spspStakesTracker.computeStakedPSPBalanceLegacy(
            account,
            timestamp,
            eofEpochTimestampForBackwardCompat,
          )
        : epoch < GasRefundVirtualLockupStartEpoch
        ? spspStakesTracker.computeStakedPSPBalance(account, timestamp)
        : spspStakesTracker.computeStakedPSPBalanceWithVirtualLockup(
            account,
            timestamp,
          );

    if (epoch < GasRefundSafetyModuleStartEpoch) {
      return {
        combined: pspStakedInSPSP,
      };
    }

    const pspStakedInSM =
      epoch < GasRefundVirtualLockupStartEpoch
        ? safetyModuleTracker.computeStakedPSPBalanceBroken(account, timestamp)
        : epoch < GasRefundSafetyModuleAllPSPInBptFixStartEpoch
        ? safetyModuleTracker.computeStakedPSPBalanceWithVirtualLockupBroken(
            account,
            timestamp,
          )
        : safetyModuleTracker.computeStakedPSPBalanceWithVirtualLockup(
            account,
            timestamp,
          );

    return { combined: pspStakedInSPSP.plus(pspStakedInSM) };
  }
}
