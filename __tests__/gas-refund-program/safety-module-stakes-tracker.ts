import '../../src/lib/log4js';
import * as dotenv from 'dotenv';
dotenv.config();
import SafetyModuleStakesTracker from '../../scripts/gas-refund-program/staking/safety-module-stakes-tracker';
import { BNReplacer } from '../../src/lib/utils/helpers';

describe('SafetyModuleStakesTracker', () => {
  describe('snashot test for backward compat', () => {
    let tracker: SafetyModuleStakesTracker;
    const startTimestamp = 1649715553;
    const endTimestamp = 1649851552;

    beforeAll(async () => {
      tracker = new SafetyModuleStakesTracker();
      await tracker.loadHistoricalStakesWithinInterval({
        startTimestamp,
        endTimestamp,
      });
    });

    test('Init state', () => {
      // hint: Use https://etherscan.io/tokencheck-tool to check all snapshoted data

      expect(JSON.stringify(tracker.initState, BNReplacer, 2)).toMatchSnapshot(
        `SafetyModuleStakesTracker::initState at block ${tracker.startBlock}`,
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
      const pspBalanceAtTimestamp = tracker.computeStakedPSPBalanceBroken(
        '0x0e71f7a6bbae357a1cd364173ae69d3fb2e539e3',
        1649822860, // timestamp has to be within range
      );

      // hint: verify by computing data for earlier timestamp and compare staked balance with dapps like zerion or debank
      expect(pspBalanceAtTimestamp.toFixed(0)).toBe('31176610680399907896512');
    });
  });

  describe('virtual lockup - only stakes held for 7d preceding a transaction are taken into account', () => {
    const startTimestamp = 1654917473;
    const endTimestamp = 1657566578;

    let tracker: SafetyModuleStakesTracker;

    beforeAll(async () => {
      tracker = new SafetyModuleStakesTracker();

      await tracker.loadHistoricalStakesWithinInterval({
        startTimestamp,
        endTimestamp,
      });
    });

    test('account had stake for more than lockup_window and did a tx, whole stake is taken into account', () => {
      // stake : https://etherscan.io/tx/0x6ca776bf1de66ca31385a5da967bc432b4042c928aeffee3562208f735982759
      // swap : https://etherscan.io/tx/0x450e4bec3f2977caddc4a191c43db761147ca53059183287c9e337ab6741e17a

      const txTimestamp = 1655660833;
      const account = '0x88f81b95eae67461b2d687343d36852f87409a7b';

      const actualStakeAtT = tracker.computeStakedPSPBalanceBroken(
        account,
        txTimestamp,
      );
      const virtuallyLockedStakeAtT =
        tracker.computeStakedPSPBalanceWithVirtualLockupBroken(
          account,
          txTimestamp,
        );

      expect(actualStakeAtT.isEqualTo(virtuallyLockedStakeAtT)).toBeTruthy();
    });

    test('account had some stakes and staked more within [t-lockup_window, t[ and did a new tx at t, take into account only part of stake held for last 7d', () => {
      // first staked: 0xc413fded33705a1877211ee1a3f88800eb8c63a11fb11298c094e0255b2fee4f - ~1000 PSP - at t - 10d
      // second staked: 0xf29c2c99da6d4e44ae7d2b21bf935a5a94b651827ed1264375f243394ec7c906 - ~7 PSP   - at t - 4d
      // then did tx: 0x1c7a1bd67e4db53f622f8d9e1c22a6e4ff6dc152ffc9ca89aef1729aa2a3da95 - at t

      const txTimestamp = 1657252834;
      const account = '0x4532280a66a0c1c709f7e0c40b14b4dea83253c1';

      const actualStakeAtT = tracker.computeStakedPSPBalanceBroken(
        account,
        txTimestamp,
      );
      const virtuallyLockedStakeAtT =
        tracker.computeStakedPSPBalanceWithVirtualLockupBroken(
          account,
          txTimestamp,
        );

      expect(virtuallyLockedStakeAtT.isLessThan(actualStakeAtT)).toBeTruthy();

      expect(actualStakeAtT.toFixed(0)).toBe('1364657414057644135201');
      expect(virtuallyLockedStakeAtT.toFixed(0)).toBe('994128705008224339309');
    });

    // this test is meant as a safe guard. On some buggy iterations the algo was picking future stakes.
    test('had some stake and withdrew it all  within [t-lockup_window, t[ and did a new tx at t, should not take into account any stake', () => {
      // redeem: https://etherscan.io/tx/0xb1ab807d5939ccec01adfbe74528abbe54278f0a26a98a05d3592093612395cd
      // swap:  https://etherscan.io/tx/0xb4a441329d92eabf6db2467e1b7d2d83196c2ee3caf8755a7f9c3896e0afbeda

      const txTimestamp = 1656472361;
      const account = '0xfc44a13ea1a98166ffc0719f83b5f3ee2759c03f';

      const actualStakeAtT = tracker.computeStakedPSPBalanceBroken(
        account,
        txTimestamp,
      );

      const virtuallyLockedStakeAtT =
        tracker.computeStakedPSPBalanceWithVirtualLockupBroken(
          account,
          txTimestamp,
        );

      expect(actualStakeAtT.isEqualTo(virtuallyLockedStakeAtT)).toBeTruthy();
      expect(actualStakeAtT.isZero()).toBeTruthy();
    });
  });
});
