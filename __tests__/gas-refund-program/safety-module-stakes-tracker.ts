import '../../src/lib/log4js';
import * as dotenv from 'dotenv';
dotenv.config();
import SafetyModuleStakesTracker from '../../scripts/gas-refund-program/staking/safety-module-stakes-tracker';
import { BNReplacer } from '../../src/lib/utils/helpers';

describe('SafetyModuleStakesTracker', () => {
  describe('snashot test for backward compat', () => {
    let tracker: SafetyModuleStakesTracker;
    const startBlock = 14567000;

    beforeAll(async () => {
      tracker = new SafetyModuleStakesTracker();
      tracker.setBlockBoundary(startBlock + 1, startBlock + 10000);
      await tracker.loadStakes();
    });

    test('Init state', () => {
      // hint: Use https://etherscan.io/tokencheck-tool to check all snapshoted data

      expect(JSON.stringify(tracker.initState, BNReplacer, 2)).toMatchSnapshot(
        `SafetyModuleStakesTracker::initState at block ${startBlock}`,
      );
    });

    test('Differential state', () => {
      expect(
        JSON.stringify(tracker.differentialStates, BNReplacer, 2),
      ).toMatchSnapshot(
        `SafetyModuleStakesTracker::differentialState between block ${tracker.startBlock} and ${tracker.endBlock}`,
      );
    });

    test('Staked PSP Balance at timestamp', () => {
      const pspBalanceAtTimestamp = tracker.computeStakedPSPBalance(
        '0x0e71f7a6bbae357a1cd364173ae69d3fb2e539e3',
        1649822860, // timestamp has to be within range
      );

      // hint: verify by computing data for earlier timestamp and compare staked balance with dapps like zerion or debank
      expect(pspBalanceAtTimestamp.toFixed(0)).toBe('31176610680399907896512');
    });
  });
});
