import BigNumber from 'bignumber.js';
import { assert } from 'ts-essentials';
import { AbstractStateTracker } from './abstract-state-tracker';
import BPTStateTracker from './bpt-state-tracker';
import ERC20StateTracker from './erc20-state-tracker';

type V2Params = {
  sePSP1: string;
  sePSP2: string;
  bpt: string;
  poolId: string;
};
const config: {
  [chainId: number]: V2Params;
} = {
  5: {
    sePSP1: '',
    sePSP2: '',
    bpt: '',
    poolId: '',
  },
};

export class StakeV2Resolver extends AbstractStateTracker {
  sePSP1Tracker: ERC20StateTracker;
  sePSP2Tracker: ERC20StateTracker;
  bptTracker: BPTStateTracker;

  constructor(protected chainId: number) {
    super(chainId);
    const { sePSP1, sePSP2 } = config[chainId] || {};
    assert(sePSP1);
    assert(sePSP2);

    this.sePSP1Tracker = ERC20StateTracker.getInstance(chainId, sePSP1);
    this.sePSP2Tracker = ERC20StateTracker.getInstance(chainId, sePSP2);
    this.bptTracker = BPTStateTracker.getInstance(chainId);
  }

  async loadWithinInterval(startTimestamp: number, endTimestamp: number) {
    await this.resolveBlockBoundary({ startTimestamp, endTimestamp });

    // TODOe prevent loading blocks data everytime
    await Promise.all([
      this.sePSP1Tracker.loadHistoricalstatesWithinInterval({
        startTimestamp,
        endTimestamp,
      }),
      this.sePSP1Tracker.loadHistoricalstatesWithinInterval({
        startTimestamp,
        endTimestamp,
      }),
      this.bptTracker.loadHistoricalstatesWithinInterval({
        startTimestamp,
        endTimestamp,
      }),
    ]);
  }

  getStakeForRefund(timestamp: number, account: string): BigNumber {
    this.assertTimestampWithinLoadInterval(timestamp);

    const sePSP1Balance = this.sePSP1Tracker.getBalance(timestamp, account);
    const sePSP2Balance = this.sePSP2Tracker.getBalance(timestamp, account);
    const { pspBalance, totalSupply } = this.bptTracker.getBPTState(timestamp);

    const pspInSePSP2 = sePSP2Balance
      .multipliedBy(pspBalance)
      .dividedBy(totalSupply);

    const stake = sePSP1Balance.plus(pspInSePSP2.multipliedBy(2.5));

    return stake;
  }
}
