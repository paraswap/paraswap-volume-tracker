import BigNumber from 'bignumber.js';
import { assert } from 'ts-essentials';

export class AbstractStakesTracker {
  startBlock: number;
  endBlock: number;
  startTimestamp: number;
  endTimestamp: number;

  setBlockBoundary({
    startBlock,
    endBlock,
    startTimestamp,
    endTimestamp,
  }: {
    startBlock: number;
    endBlock: number;
    startTimestamp: number;
    endTimestamp: number;
  }) {
    this.startBlock = startBlock;
    this.endBlock = endBlock;
    this.startTimestamp = startTimestamp;
    this.endTimestamp = endTimestamp;

    return this;
  }

  assertTimestampWithinLoadInterval(timestamp: number) {
    assert(
      timestamp >= this.startTimestamp && timestamp <= this.endTimestamp,
      'timestamp is out of range',
    );
  }
}

export interface IStakesTracker {
  loadStakes: () => Promise<void>;
  computeStakedPSPBalance: (account: string, timestamp: number) => BigNumber;
  computeStakedPSPBalanceWithVirtualLockup: (
    account: string,
    timestamp: number,
  ) => BigNumber;
}
