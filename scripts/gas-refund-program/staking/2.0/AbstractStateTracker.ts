import { assert } from 'ts-essentials';
import { BlockInfo } from '../../../../src/lib/block-info';
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

  async loadHistoricalstatesWithinInterval({
    startTimestamp,
    endTimestamp,
  }: {
    startTimestamp: number;
    endTimestamp: number;
  }) {
    await this.resolveBlockBoundary({ startTimestamp, endTimestamp });
    await this.loadStates();
  }

  async resolveBlockBoundary({
    startTimestamp,
    endTimestamp,
  }: {
    startTimestamp: number;
    endTimestamp: number;
  }) {
    const blockInfo = BlockInfo.getInstance(this.chainId);
    const [_startBlock, _endBlock] = await Promise.all([
      blockInfo.getBlockAfterTimeStamp(startTimestamp),
      blockInfo.getBlockAfterTimeStamp(endTimestamp),
    ]);

    assert(
      typeof _endBlock === 'number' && _endBlock > 0,
      '_endBlock should be a number greater than 0',
    );
    assert(
      typeof _startBlock === 'number' &&
        _startBlock > 0 &&
        _startBlock < _endBlock,
      '_startBlock should be a number and 0 < _startBlock < endBlock',
    );

    this.setBlockTimeBoundary({
      startTimestamp,
      endTimestamp,
      startBlock: _startBlock,
      endBlock: _endBlock,
    });
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

  protected loadStates() {
    throw new Error('Implement on child class');
  }

  assertTimestampWithinLoadInterval(timestamp: number) {
    assert(
      timestamp >= this.startTimestamp && timestamp <= this.endTimestamp,
      'timestamp is out of range',
    );
  }
}
