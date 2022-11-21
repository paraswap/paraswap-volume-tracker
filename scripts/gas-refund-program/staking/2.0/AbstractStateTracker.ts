import { assert } from 'ts-essentials';
import {
  CHAIN_ID_GOERLI,
  CHAIN_ID_MAINNET,
} from '../../../../src/lib/constants';

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
      chainId == CHAIN_ID_MAINNET || chainId === CHAIN_ID_GOERLI,
      'only ethereum mainnet or testnet allowed',
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
