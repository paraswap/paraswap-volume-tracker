import BigNumber from 'bignumber.js';
import { assert } from 'ts-essentials';
import { BlockInfo } from '../../../../src/lib/block-info';
import {  
  grp2ConfigByChain_V3,  
  grp3GlobalConfig,
  grpConfigParticularities_V3,
  STAKING_V3_TIMESTAMP,
} from '../../../../src/lib/gas-refund/config';
import { AbstractStateTracker } from './AbstractStateTracker';
import ERC20StateTracker from './ERC20StateTracker';
import { StakedScoreV3 } from '../stakes-tracker';
import BPTStateTracker_V3 from './BPTStateTracker_V3';

export class StakeV3Resolver extends AbstractStateTracker {
  seXYZTracker: ERC20StateTracker;
  bptTracker: BPTStateTracker_V3;

  static instance: { [chainId: string]: StakeV3Resolver } = {};

  constructor(protected chainId: number) {
    super(chainId);
    const { seXYZ } = grp2ConfigByChain_V3[chainId] || {};
    assert(seXYZ, 'seXYZ must be defined');

    this.seXYZTracker = ERC20StateTracker.getInstance(chainId, seXYZ);
    this.bptTracker = BPTStateTracker_V3.getInstance(chainId);
  }

  static getInstance(chainId: number) {
    if (!StakeV3Resolver.instance[chainId]) {
      StakeV3Resolver.instance[chainId] = new StakeV3Resolver(chainId);
    }

    return StakeV3Resolver.instance[chainId];
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
    // set staking start time higher if staking contracts have been deployed after epoch start

    const deploymentTimestamp =
      grpConfigParticularities_V3[this.chainId].stakingStartCalcTimestamp;

    const startTimestamp = Math.max(
      epochStartTimestamp,
      deploymentTimestamp || 0,
    );

    await this.resolveBlockBoundary({ startTimestamp, endTimestamp });

    const boundary = this.getBlockTimeBoundary();
    assert(
      boundary.startTimestamp === startTimestamp &&
        boundary.endTimestamp == endTimestamp,
      'wrong boundary resolved',
    );

    this.seXYZTracker.setBlockTimeBoundary(boundary);
    this.bptTracker.setBlockTimeBoundary(boundary);

    await Promise.all([
      this.seXYZTracker.loadStates(),
      this.bptTracker.loadStates(),
    ]);
  }

  // returns stakesScore(t)
  getStakeForRefund(
    timestamp: number,
    account: string,
  ): StakedScoreV3['byNetwork'][number] {
    this.assertTimestampWithinLoadInterval(timestamp);

    const seXYZBalance = this.seXYZTracker.getBalance(timestamp, account);

    const { xyzBalance: bptXYZBalance, totalSupply: bptTotalSupply } =
      this.bptTracker.getBPTState(timestamp);

    const xyzInSeXYZ = seXYZBalance // 1 BPT = 1 seXYZ
      .multipliedBy(bptXYZBalance)
      .dividedBy(bptTotalSupply)
      .decimalPlaces(0, BigNumber.ROUND_DOWN);

    const stake = xyzInSeXYZ
      .multipliedBy(grp3GlobalConfig.seXYZPowerMultiplier)
      .decimalPlaces(0, BigNumber.ROUND_DOWN);

    return {
      stakeScore: stake.toFixed(),
      seXYZBalance: seXYZBalance.toFixed(),
      bptTotalSupply: bptTotalSupply.toFixed(),
      bptXYZBalance: bptXYZBalance.toFixed(),
    };
  }
}
