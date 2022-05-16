import { assert } from 'ts-essentials';
import { BlockInfo } from '../../../src/lib/block-info';
import { CHAIN_ID_MAINNET } from '../../../src/lib/constants';
import { EpochInfo } from '../../../src/lib/epoch-info';
import {
  GasRefundGenesisEpoch,
  GasRefundSafetyModuleStartEpoch,
  GasRefundSPSPStakesAlgoFlipEpoch,
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

    const [startBlockSPSP, startBlockSM, endBlock] = await Promise.all([
      blockInfo.getBlockAfterTimeStamp(startTimeSPSP),
      blockInfo.getBlockAfterTimeStamp(startTimeSM),
      blockInfo.getBlockAfterTimeStamp(endTime),
    ]);

    assert(
      typeof endBlock === 'number' && endBlock > 0,
      'endBlock should be a number greater than 0',
    );
    assert(
      typeof startBlockSPSP === 'number' &&
        startBlockSPSP > 0 &&
        startBlockSPSP < endBlock,
      'startBlockSPSP should be a number and 0 < startBlockSPSP < endBlock',
    );
    assert(
      typeof startBlockSM === 'number' &&
        startBlockSM > 0 &&
        startBlockSM < endBlock,
      'startBlockSM should be a number and 0 < startBlockSM < endBlock',
    );

    await Promise.all([
      SPSPStakesTracker.getInstance()
        .setBlockBoundary(startBlockSPSP, endBlock)
        .loadStakes(),
      SafetyModuleStakesTracker.getInstance()
        .setBlockBoundary(startBlockSM, endBlock)
        .loadStakes(),
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

    const pspStakedInSPSP =
      epoch < GasRefundSPSPStakesAlgoFlipEpoch
        ? spspStakesTracker.computeStakedPSPBalanceLegacy(
            account,
            timestamp,
            eofEpochTimestampForBackwardCompat,
          )
        : spspStakesTracker.computeStakedPSPBalance(account, timestamp);

    if (epoch < GasRefundSafetyModuleStartEpoch) {
      return pspStakedInSPSP;
    }

    const pspStakedInSM =
      SafetyModuleStakesTracker.getInstance().computeStakedPSPBalance(
        account,
        timestamp,
      );

    return pspStakedInSPSP.plus(pspStakedInSM);
  }
}
