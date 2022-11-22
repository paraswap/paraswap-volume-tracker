import { assert, AsyncOrSync } from 'ts-essentials';
import { CHAIN_ID_MAINNET } from '../../src/lib/constants';
import { EpochInfo } from '../../src/lib/epoch-info';
import { GasRefundV2EpochFlip } from '../../src/lib/gas-refund';
import { OFFSET_CALC_TIME, SCRIPT_START_TIME_SEC } from './common';

type EpochCalcTime = {
  startCalcTime: number;
  endCalcTime: number;
  isEpochEnded: boolean;
};

type BaseEpochResolver = {
  init: () => void;
  getCurrentEpoch: () => number;
  getEpochStartCalcTime: (epoch: number) => AsyncOrSync<number>;
  resolveEpochCalcTimeInterval: (epoch: number) => AsyncOrSync<EpochCalcTime>;
};

const GRP1EpochResolver: BaseEpochResolver = {
  async init() {
    const epochInfo = EpochInfo.getInstance(CHAIN_ID_MAINNET, true);
    await epochInfo.getEpochInfo();
  },
  getCurrentEpoch() {
    const currentEpoch = EpochInfo.getInstance(
      CHAIN_ID_MAINNET,
      true,
    ).currentEpoch;

    assert(currentEpoch, 'currentEpoch should defined');

    return currentEpoch;
  },
  getEpochStartCalcTime(epoch: number) {
    const epochInfo = EpochInfo.getInstance(CHAIN_ID_MAINNET, true);

    return epochInfo.getEpochStartCalcTime(epoch);
  },
  async resolveEpochCalcTimeInterval(epoch: number): Promise<EpochCalcTime> {
    const epochInfo = EpochInfo.getInstance(CHAIN_ID_MAINNET, true);
    const [epochStartTime, epochDuration] = await Promise.all([
      epochInfo.getEpochStartCalcTime(epoch),
      epochInfo.getEpochDuration(),
    ]);
    const epochEndTime = epochStartTime + epochDuration; // safer than getEpochEndCalcTime as it fails for current epoch
    const isEpochEnded =
      SCRIPT_START_TIME_SEC >= epochEndTime + OFFSET_CALC_TIME;
    const endCalcTime = Math.min(
      SCRIPT_START_TIME_SEC - OFFSET_CALC_TIME,
      epochEndTime,
    );

    return {
      startCalcTime: epochStartTime,
      endCalcTime,
      isEpochEnded,
    };
  },
};

// TODO: move to config
const START_EPOCH_TIMESTAMP_V2 = 1667260800; // 1 nov sept to test // TODO move config
const EPOCH_DURATION_V2 = 30 * 24 * 60 * 60; // TODO move config

type EpochReseolverV2 = BaseEpochResolver & {
  resolveEpochNumber: (timestamp: number) => number;
  getEpochTimeBoundary: (epoch: number) => {
    startTimestamp: number;
    endTimestamp: number;
  };
};

const GRP2EpochResolver: EpochReseolverV2 = {
  init() {
    // nothing to do ?
  },
  getCurrentEpoch() {
    return GRP2EpochResolver.resolveEpochNumber(Math.floor(Date.now() / 1000));
  },
  resolveEpochNumber(timestamp: number) {
    return (
      Math.floor((timestamp - START_EPOCH_TIMESTAMP_V2) / EPOCH_DURATION_V2) +
      GasRefundV2EpochFlip
    );
  },

  getEpochTimeBoundary(epoch: number) {
    const startTimestamp = START_EPOCH_TIMESTAMP_V2 + EPOCH_DURATION_V2 * epoch;
    const endTimestamp = startTimestamp + EPOCH_DURATION_V2;

    return {
      startTimestamp,
      endTimestamp,
    };
  },

  getEpochStartCalcTime(epoch: number) {
    const { startTimestamp } = GRP2EpochResolver.getEpochTimeBoundary(epoch);
    return startTimestamp;
  },

  async resolveEpochCalcTimeInterval(epoch: number): Promise<EpochCalcTime> {
    const { startTimestamp, endTimestamp } =
      GRP2EpochResolver.getEpochTimeBoundary(epoch);

    return {
      // FIXME
      startCalcTime: startTimestamp,
      endCalcTime: endTimestamp,
      isEpochEnded: true,
    };
  },
};

//// V1 & V2 CONSOLIDATED

const getEpochResolverForEpoch = (epoch: number): BaseEpochResolver =>
  epoch >= GasRefundV2EpochFlip ? GRP2EpochResolver : GRP1EpochResolver;

const getEpochResolverForNow = (): BaseEpochResolver =>
  Math.floor(Date.now() / 1000) >= START_EPOCH_TIMESTAMP_V2
    ? GRP2EpochResolver
    : GRP1EpochResolver;

export const loadEpochMetaData = () => getEpochResolverForNow().init();
export const resolveEpochCalcTimeInterval = (epoch: number) =>
  getEpochResolverForEpoch(epoch).resolveEpochCalcTimeInterval(epoch);
export const getCurrentEpoch = () => getEpochResolverForNow().getCurrentEpoch();
export const getEpochStartCalcTime = (epoch: number) =>
  getEpochResolverForEpoch(epoch).getEpochStartCalcTime(epoch);
