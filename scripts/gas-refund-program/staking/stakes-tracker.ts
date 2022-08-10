import { assert } from 'ts-essentials';
import { BlockInfo } from '../../../src/lib/block-info';
import { CHAIN_ID_MAINNET } from '../../../src/lib/constants';
import { EpochInfo } from '../../../src/lib/epoch-info';
import {
  GasRefundGenesisEpoch,
  GasRefundSafetyModuleStartEpoch,
  GasRefundSPSPStakesAlgoFlipEpoch,
  GasRefundVirtualLockupStartEpoch,
} from '../../../src/lib/gas-refund';
import { OFFSET_CALC_TIME, SCRIPT_START_TIME_SEC } from '../common';
import { getLatestEpochRefundedAllChains } from '../persistance/db-persistance';
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
    const blockInfo = BlockInfo.getInstance(CHAIN_ID_MAINNET);
    const epochInfo = EpochInfo.getInstance(CHAIN_ID_MAINNET, true);

    // @FIXME: as this has to be aligned with the logic where we scan transactions
    // we have to come up with a stronger implem to always make sure tx scanning time isn't lower than stakes fetching time
    const latestEpochRefunded = await getLatestEpochRefundedAllChains();

    // Note: since we take start of latest epoch refunded, we don't need adjust start times with VIRTUAL_LOCKUP_PERIOD
    const startTimeSPSP = await epochInfo.getEpochStartCalcTime(
      latestEpochRefunded || GasRefundGenesisEpoch,
    );

    const startTimeSM = await epochInfo.getEpochStartCalcTime(
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

  computeStakedPSPBalance(
    _account: string,
    timestamp: number,
    epoch: number,
    eofEpochTimestampForBackwardCompat: number,
  ) {
    const account = _account.toLowerCase();

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
        ? safetyModuleTracker.computeStakedPSPBalance(account, timestamp)
        : safetyModuleTracker.computeStakedPSPBalanceWithVirtualLockup(
            account,
            timestamp,
          );

    return pspStakedInSPSP.plus(pspStakedInSM);
  }
}
