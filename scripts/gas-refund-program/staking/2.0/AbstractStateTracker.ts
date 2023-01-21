import { assert } from 'ts-essentials';
import { GRP_V2_SUPPORTED_CHAINS_STAKING } from '../../../../src/lib/gas-refund';

type BlockTimeBoundary = {
  startTimestamp: number;
  endTimestamp: number;
  startBlock: number;
  endBlock: number;
};
export class AbstractStateTracker {
  startBlock: number;
  endBlock: number;
  startTimestamp: number;
  endTimestamp: number;

  constructor(protected chainId: number) {
    assert(
      GRP_V2_SUPPORTED_CHAINS_STAKING.has(chainId),
      `chainId=${chainId} is not support for staking`,
    );
  }

  getBlockTimeBoundary(): BlockTimeBoundary {
    return {
      startTimestamp: this.startTimestamp,
      endTimestamp: this.endTimestamp,
      startBlock: this.startBlock,
      endBlock: this.endBlock,
    };
  }

  setBlockTimeBoundary({
    startTimestamp,
    endTimestamp,
    startBlock,
    endBlock,
  }: BlockTimeBoundary) {
    this.startTimestamp = startTimestamp;
    this.endTimestamp = endTimestamp;
    this.startBlock = startBlock;
    this.endBlock = endBlock;
  }

  assertTimestampWithinLoadInterval(timestamp: number) {
    assert(
      timestamp >= this.startTimestamp && timestamp <= this.endTimestamp,
      'timestamp is out of range',
    );
  }
}
