import { assert } from 'ts-essentials';
import { BlockInfo } from '../../../src/lib/block-info';
import { CHAIN_ID_MAINNET } from '../../../src/lib/constants';
import { EpochInfo } from '../../../src/lib/epoch-info';
import {
  GasRefundGenesisEpoch,
  GasRefundSafetyModuleStartEpoch,
  GasRefundSPSPStakesAlgoFlipEpoch,
} from '../../../src/lib/gas-refund';
import { OFFSET_CALC_TIME } from '../common';
import { getLatestTransactionTimestamp } from '../persistance/db-persistance';
import { ONE_HOUR_SEC, startOfHourSec } from '../utils';
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

    const latestTxTimestamp = await getLatestTransactionTimestamp();

    const startTimeSPSP = await epochInfo.getEpochStartCalcTime(
      GasRefundGenesisEpoch,
    );

    const startTimeSM =
      latestTxTimestamp ||
      (await epochInfo.getEpochStartCalcTime(GasRefundSafetyModuleStartEpoch));

    const endTime = Math.round(Date.now() / 1000) - OFFSET_CALC_TIME;

    const [startBlockSPSP, startBlockSM, endBlock] = await Promise.all([
      blockInfo.getBlockAfterTimeStamp(startTimeSPSP),
      blockInfo.getBlockAfterTimeStamp(startTimeSM),
      blockInfo.getBlockAfterTimeStamp(endTime),
    ]);

    assert(
      typeof startBlockSPSP === 'number' && startBlockSPSP > 0,
      'startBlockSPSP should be a number greater than 0',
    );
    assert(
      typeof startBlockSM === 'number' && startBlockSM > 0,
      'startBlockSM should be a number greater than 0',
    );
    assert(
      typeof endBlock === 'number' && endBlock > 0,
      'startBlock should be a number greater than 0',
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

  computeStakedPSPBalanceLegacy(
    account: string,
    timestamp: number,
    epoch: number,
    endTimestamp: number,
  ) {
    const startOfHourTimestampUnix = startOfHourSec(timestamp);
    const endOfHourTimestampUnix = startOfHourSec(timestamp + ONE_HOUR_SEC);

    const endOfHourLaterThanEpoch = endOfHourTimestampUnix > endTimestamp;

    const stakedPSPStartOfHour =
      SPSPStakesTracker.getInstance().computeStakedPSPBalance(
        account,
        startOfHourTimestampUnix,
      );

    const stakedPSPEndOfHour = endOfHourLaterThanEpoch
      ? BigInt(0)
      : SPSPStakesTracker.getInstance().computeStakedPSPBalance(
          account,
          endOfHourTimestampUnix,
        );

    return stakedPSPStartOfHour > stakedPSPEndOfHour ? stakedPSPStartOfHour : stakedPSPEndOfHour;
  }

  computeStakedPSPBalance(
    _account: string,
    timestamp: number,
    epoch: number,
    eofEpochTimestampForBackwardCompat: number,
  ) {
    const account = _account.toLowerCase();

    const pspStakedInSPSP =
      epoch < GasRefundSPSPStakesAlgoFlipEpoch
        ? this.computeStakedPSPBalanceLegacy(
            account,
            timestamp,
            epoch,
            eofEpochTimestampForBackwardCompat,
          )
        : SPSPStakesTracker.getInstance().computeStakedPSPBalance(
            account,
            timestamp,
          );

    if (epoch < GasRefundSafetyModuleStartEpoch) {
      return pspStakedInSPSP;
    }

    const pspStakedInSM =
      SafetyModuleStakesTracker.getInstance().computeStakedPSPBalance(
        account,
        timestamp,
      );

    return pspStakedInSPSP + pspStakedInSM;
  }
}
