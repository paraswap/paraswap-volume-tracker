import { assert } from 'ts-essentials';
import {
  OFFSET_CALC_TIME,
  SCRIPT_START_TIME_SEC,
} from '../../../src/lib/gas-refund/common';
import {
  forceStakingChainId,
  grp2CConfigParticularities,
} from '../../../src/lib/gas-refund/config';
import {
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
  GasRefundVirtualLockupStartEpoch,
} from '../../../src/lib/gas-refund/gas-refund';
import { getLatestEpochRefundedAllChains } from '../persistance/db-persistance';
import { StakeV2Resolver } from './2.0/StakeV2Resolver';
import SafetyModuleStakesTracker from './safety-module-stakes-tracker';
import SPSPStakesTracker from './spsp-stakes-tracker';
import BigNumber from 'bignumber.js';

import { GasRefundTransactionStakeSnapshotData } from '../../../src/models/GasRefundTransactionStakeSnapshot';
import { fetchLastMultichainDistribution } from '../transactions-indexing/fetchRefundableTransactionsAllChains';

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

export type StakedScoreV1 = {
  combined: BigNumber;
};

export function isStakeScoreV2(
  stakeScore: StakedScoreV1 | StakedScoreV2,
): stakeScore is StakedScoreV2 {
  return 'byNetwork' in stakeScore;
}
export default class StakesTracker {
  chainIds = [forceStakingChainId(CHAIN_ID_MAINNET), CHAIN_ID_OPTIMISM];

  static instance: StakesTracker;

  static getInstance() {
    if (!this.instance) {
      this.instance = new StakesTracker();
    }
    return this.instance;
  }

  async loadHistoricalStakes() {
    const lastMultichainDistribution = await fetchLastMultichainDistribution();
    const epochToStartFrom = lastMultichainDistribution
      ? lastMultichainDistribution + 1 /// start from the currently indexed epoch (i.e. next one after the last indexed one)
      : await getLatestEpochRefundedAllChains();

    const endTime = SCRIPT_START_TIME_SEC - OFFSET_CALC_TIME;

    // V2
    const currentEpoch = getCurrentEpoch();
    if (currentEpoch >= GasRefundV2EpochFlip) {
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
  ): StakedScoreV2 | StakedScoreV1 {
    const account = _account.toLowerCase();

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
