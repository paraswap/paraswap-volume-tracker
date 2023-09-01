import BigNumber from 'bignumber.js';
import { assert } from 'ts-essentials';
import { BlockInfo } from '../../../../src/lib/block-info';
import {
  grp2CConfigParticularities,
  grp2ConfigByChain,
  grp2GlobalConfig,
} from '../../../../src/lib/gas-refund/config';
import { AbstractStateTracker } from './AbstractStateTracker';
import BPTStateTracker from './BPTStateTracker';
import { ClaimableSePSP1StateTracker } from './ClaimableSePSP1StateTracker';
import ERC20StateTracker from './ERC20StateTracker';

export class StakeV2Resolver extends AbstractStateTracker {
  sePSP1Tracker: ERC20StateTracker;
  sePSP2Tracker: ERC20StateTracker;
  bptTracker: BPTStateTracker;
  claimableSePSP1Tracker: ClaimableSePSP1StateTracker;
  static instance: { [chainId: string]: StakeV2Resolver } = {};

  constructor(protected chainId: number) {
    super(chainId);
    const { sePSP1, sePSP2 } = grp2ConfigByChain[chainId] || {};
    assert(sePSP1);
    assert(sePSP2);

    this.sePSP1Tracker = ERC20StateTracker.getInstance(chainId, sePSP1);
    this.sePSP2Tracker = ERC20StateTracker.getInstance(chainId, sePSP2);
    this.bptTracker = BPTStateTracker.getInstance(chainId);
    this.claimableSePSP1Tracker =
      ClaimableSePSP1StateTracker.getInstance(chainId);
  }

  static getInstance(chainId: number) {
    if (!StakeV2Resolver.instance[chainId]) {
      StakeV2Resolver.instance[chainId] = new StakeV2Resolver(chainId);
    }

    return StakeV2Resolver.instance[chainId];
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

  async loadWithinInterval(epochStartTimestamp: number, endTimestamp: number) {
    const startTimestamp =
      grp2CConfigParticularities[this.chainId].stakingStartCalcTimestamp && // set staking start time higher if staking contracts have been deployed after epoch start
      epochStartTimestamp <
        grp2CConfigParticularities[this.chainId].stakingStartCalcTimestamp!
        ? grp2CConfigParticularities[this.chainId].stakingStartCalcTimestamp!
        : epochStartTimestamp;

    await this.resolveBlockBoundary({ startTimestamp, endTimestamp });

    const boundary = this.getBlockTimeBoundary();
    assert(
      boundary.startTimestamp === startTimestamp &&
        boundary.endTimestamp == endTimestamp,
      'wrong boundary resolved',
    );

    this.sePSP1Tracker.setBlockTimeBoundary(boundary);
    this.sePSP2Tracker.setBlockTimeBoundary(boundary);
    this.bptTracker.setBlockTimeBoundary(boundary);
    this.claimableSePSP1Tracker.setBlockTimeBoundary(boundary);

    await Promise.all([
      this.sePSP1Tracker.loadStates(),
      this.sePSP2Tracker.loadStates(),
      this.bptTracker.loadStates(),
      this.claimableSePSP1Tracker.loadStates(),
    ]);
  }

  // returns stakesScore(t)
  getStakeForRefund(timestamp: number, account: string): BigNumber {
    this.assertTimestampWithinLoadInterval(timestamp);

    const sePSP1Balance = this.sePSP1Tracker.getBalance(timestamp, account);
    const sePSP2Balance = this.sePSP2Tracker.getBalance(timestamp, account);
    const claimableSePSP1 = this.claimableSePSP1Tracker.getBalance(
      timestamp,
      account,
    );
    const { pspBalance: bptPSPBalance, totalSupply: bptTotalSupply } =
      this.bptTracker.getBPTState(timestamp);

    const pspInSePSP2 = sePSP2Balance // 1 BPT = 1 sePSP2
      .multipliedBy(bptPSPBalance)
      .dividedBy(bptTotalSupply)
      .decimalPlaces(0, BigNumber.ROUND_DOWN);

    const stake = sePSP1Balance
      .plus(claimableSePSP1)
      .plus(pspInSePSP2.multipliedBy(grp2GlobalConfig.sePSP2PowerMultiplier))
      .decimalPlaces(0, BigNumber.ROUND_DOWN);

    return stake;
  }
}
