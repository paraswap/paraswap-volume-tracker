import { assert } from 'ts-essentials';
import { GRP_V2_SUPPORTED_CHAINS_STAKING } from '../../../../src/lib/gas-refund/gas-refund';
import { STAKING_CHAIN_IDS_V3 } from '../../../../src/lib/gas-refund/config';

export type BlockTimeBoundary = {
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
    const stakingChains = new Set([
      ...GRP_V2_SUPPORTED_CHAINS_STAKING,
      ...STAKING_CHAIN_IDS_V3,
    ])
    assert(
      stakingChains.has(chainId),
      `chainId=${chainId} is not supported for staking`,
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
    try {
      assert(
        timestamp >= this.startTimestamp && timestamp <= this.endTimestamp,
        'timestamp is out of range',
      );
    } catch (e) {
      debugger;
      throw e;
    }
  }
}
