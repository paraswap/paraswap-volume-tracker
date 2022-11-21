import EventEmitter from 'events';
import { assert } from 'ts-essentials';
import { BlockInfo } from '../../../../src/lib/block-info';
import {
  CHAIN_ID_GOERLI,
  CHAIN_ID_MAINNET,
} from '../../../../src/lib/constants';

export class AbstractStateTracker extends EventEmitter {
  startBlock: number;
  endBlock: number;
  startTimestamp: number;
  endTimestamp: number;

  constructor(protected chainId: number) {
    assert(
      chainId == CHAIN_ID_MAINNET || chainId === CHAIN_ID_GOERLI,
      'only ethereum mainnet or testnet allowed',
    );
    super();
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

    this.startTimestamp = startTimestamp;
    this.endTimestamp = endTimestamp;
    this.startBlock = _startBlock;
    this.endBlock = _endBlock;
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
