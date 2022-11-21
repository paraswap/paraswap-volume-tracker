import { assert } from 'ts-essentials';
import { CHAIN_ID_MAINNET } from '../../../src/lib/constants';
import {
  GasRefundGenesisEpoch,
  GasRefundSafetyModuleAllPSPInBptFixStartEpoch,
  GasRefundSafetyModuleStartEpoch,
  GasRefundSPSPStakesAlgoFlipEpoch,
  GasRefundV2EpochFlip,
  GasRefundVirtualLockupStartEpoch,
} from '../../../src/lib/gas-refund';
import { OFFSET_CALC_TIME, SCRIPT_START_TIME_SEC } from '../common';
import { getCurrentEpoch, getEpochStartCalcTime } from '../epoch-helpers';
import { getLatestEpochRefundedAllChains } from '../persistance/db-persistance';
import { StakeV2Resolver } from './2.0/StakeV2Resolver';
import SafetyModuleStakesTracker from './safety-module-stakes-tracker';
import SPSPStakesTracker from './spsp-stakes-tracker';

export default class StakesTracker {
  static instance: StakesTracker;

  static getInstance() {
    if (!this.instance) {
      this.instance = new StakesTracker();
    }
    return this.instance;
  }

  async loadHistoricalStakes() {
    const latestEpochRefunded = await getLatestEpochRefundedAllChains();

    // Note: since we take start of latest epoch refunded, we don't need adjust start times with VIRTUAL_LOCKUP_PERIOD
    const startTimeSPSP = await getEpochStartCalcTime(
      latestEpochRefunded || GasRefundGenesisEpoch,
    );

    const startTimeStakeV2 = await getEpochStartCalcTime(
      latestEpochRefunded || GasRefundV2EpochFlip,
    );

    const startTimeSM = await getEpochStartCalcTime(
      latestEpochRefunded &&
        latestEpochRefunded > GasRefundSafetyModuleStartEpoch
        ? latestEpochRefunded
        : GasRefundSafetyModuleStartEpoch,
    );

    const endTime = SCRIPT_START_TIME_SEC - OFFSET_CALC_TIME;

    assert(
      startTimeSPSP < endTime,
      'startTimeSPSP should be less than endTime',
    );
    assert(startTimeSM < endTime, 'startTimeSM should be less than endTime');

    const spspStakesTracker = SPSPStakesTracker.getInstance();
    const stakeModuleStakesTracker = SafetyModuleStakesTracker.getInstance();

    if (getCurrentEpoch() >= GasRefundV2EpochFlip) {
      // FIXME
      await StakeV2Resolver.getInstance(
        CHAIN_ID_MAINNET,
      ).loadHistoricalstatesWithinInterval({
        startTimestamp: startTimeStakeV2, // fixme ?
        endTimestamp: endTime,
      });
    } else {
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

  computeStakedPSPBalance(
    _account: string,
    timestamp: number,
    epoch: number,
    eofEpochTimestampForBackwardCompat: number,
  ) {
    const account = _account.toLowerCase();

    if (epoch >= GasRefundV2EpochFlip) {
      return StakeV2Resolver.getInstance(CHAIN_ID_MAINNET).getStakeForRefund(
        timestamp,
        account,
      );
    }

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
      return pspStakedInSPSP;
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

    return pspStakedInSPSP.plus(pspStakedInSM);
  }
}
