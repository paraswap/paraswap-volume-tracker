import BigNumber from 'bignumber.js';

export class AbstractStakesTracker {
  startBlock: number;
  endBlock: number;

  setBlockBoundary(startBlock: number, endBlock: number) {
    this.startBlock = startBlock;
    this.endBlock = endBlock;

    return this;
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
