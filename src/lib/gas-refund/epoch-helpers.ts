import { assert, AsyncOrSync } from 'ts-essentials';
import { CHAIN_ID_MAINNET } from '../constants';
import { EpochInfo } from '../epoch-info';
import { GasRefundV2EpochFlip } from './gas-refund';
import { OFFSET_CALC_TIME, SCRIPT_START_TIME_SEC } from './common';
import {grp2CConfigParticularities, grp2GlobalConfig} from './config';

type EpochCalcTime = {
  startCalcTime: number;
  endCalcTime: number;
  isEpochEnded: boolean;
};

type BaseEpochResolver = {
  init: () => void;
  getCurrentEpoch: () => number;
  getEpochStartCalcTime: (epoch: number, chainId?: number) => AsyncOrSync<number>;
  resolveEpochCalcTimeInterval: (epoch: number, chainId?: number) => AsyncOrSync<EpochCalcTime>;
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

type EpochReseolverV2 = BaseEpochResolver & {
  resolveEpochNumber: (timestamp: number) => number;
  getEpochTimeBoundary: (epoch: number) => {
    startTimestamp: number;
    endTimestamp: number;
  };
};

const GRP2EpochResolver: EpochReseolverV2 = {
  init() {
    console.log('PSP2.0: nothing to do on initialising GRP2EpochResolver !');
  },
  getCurrentEpoch() {
    return GRP2EpochResolver.resolveEpochNumber(Math.floor(Date.now() / 1000));
  },
  resolveEpochNumber(timestamp: number) {
    return (
      Math.floor(
        (timestamp - grp2GlobalConfig.startEpochTimestamp) /
          grp2GlobalConfig.epochDuration,
      ) + GasRefundV2EpochFlip
    );
  },

  getEpochTimeBoundary(epoch: number) {
    const startTimestamp =
      grp2GlobalConfig.startEpochTimestamp +
      grp2GlobalConfig.epochDuration * (epoch - GasRefundV2EpochFlip);
    const endTimestamp = startTimestamp + grp2GlobalConfig.epochDuration;

    return {
      startTimestamp,
      endTimestamp,
    };
  },

  getEpochStartCalcTime(epoch: number, chainId?: number) {
    const { startTimestamp } = GRP2EpochResolver.getEpochTimeBoundary(epoch);

    if (chainId && grp2CConfigParticularities[chainId].stakingStartCalcTimestamp) {
      return startTimestamp < grp2CConfigParticularities[chainId].stakingStartCalcTimestamp!
        ? grp2CConfigParticularities[chainId].stakingStartCalcTimestamp! : startTimestamp;
    }

    return startTimestamp;
  },

  async resolveEpochCalcTimeInterval(epoch: number, chainId?: number): Promise<EpochCalcTime> {
    const { startTimestamp, endTimestamp } =
      GRP2EpochResolver.getEpochTimeBoundary(epoch);
    const isEpochEnded =
      SCRIPT_START_TIME_SEC >= endTimestamp + OFFSET_CALC_TIME;
    const endCalcTime = Math.min(
      SCRIPT_START_TIME_SEC - OFFSET_CALC_TIME,
      endTimestamp,
    );
    let startCalcTime = startTimestamp;

    if (chainId && grp2CConfigParticularities[chainId]?.stakingStartCalcTimestamp) {
      startCalcTime = startCalcTime < grp2CConfigParticularities[chainId].stakingStartCalcTimestamp!
        ? grp2CConfigParticularities[chainId].stakingStartCalcTimestamp! : startCalcTime;
    }

    return { startCalcTime, endCalcTime, isEpochEnded };
  },
};

//// V1 & V2 CONSOLIDATED

const getEpochResolverForEpoch = (epoch: number): BaseEpochResolver =>
  epoch >= GasRefundV2EpochFlip ? GRP2EpochResolver : GRP1EpochResolver;

const getEpochResolverForNow = (): BaseEpochResolver =>
  Math.floor(Date.now() / 1000) >= grp2GlobalConfig.startEpochTimestamp
    ? GRP2EpochResolver
    : GRP1EpochResolver;

export const loadEpochMetaData = () => getEpochResolverForNow().init();
export const resolveEpochCalcTimeInterval = (epoch: number, chainId?: number) =>
  getEpochResolverForEpoch(epoch).resolveEpochCalcTimeInterval(epoch, chainId);
export const getCurrentEpoch = () => getEpochResolverForNow().getCurrentEpoch();
export const getEpochStartCalcTime = (epoch: number, chainId?: number) =>
  getEpochResolverForEpoch(epoch).getEpochStartCalcTime(epoch, chainId);
export const resolveV2EpochNumber = (timestamp: number) =>
    GRP2EpochResolver.resolveEpochNumber(timestamp)
