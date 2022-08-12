import BigNumber from 'bignumber.js';
import { assert } from 'ts-essentials';
import { BlockInfo } from '../../../src/lib/block-info';
import { CHAIN_ID_MAINNET } from '../../../src/lib/constants';

export class AbstractStakesTracker {
  startBlock: number;
  endBlock: number;
  startTimestamp: number;
  endTimestamp: number;

  async loadHistoricalStakesWithinInterval({
    startTimestamp,
    endTimestamp,
  }: {
    startTimestamp: number;
    endTimestamp: number;
  }) {
    await this.resolveBlockBoundary({ startTimestamp, endTimestamp });
    await this.loadStakes();
  }

  async resolveBlockBoundary({
    startTimestamp,
    endTimestamp,
  }: {
    startTimestamp: number;
    endTimestamp: number;
  }) {
    const blockInfo = BlockInfo.getInstance(CHAIN_ID_MAINNET);
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

  protected loadStakes() {
    throw new Error('Implement on child class');
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
