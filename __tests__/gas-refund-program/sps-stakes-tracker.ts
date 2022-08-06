import '../../src/lib/log4js';
import * as dotenv from 'dotenv';
dotenv.config();
import SPSPStakesTracker from '../../scripts/gas-refund-program/staking/spsp-stakes-tracker';
import { assert } from 'ts-essentials';
import { BNReplacer } from '../../src/lib/utils/helpers';

jest.setTimeout(5 * 60 * 1000);

describe('SpspStakesTracker', () => {
  describe('snashot test for backward compat', () => {
    let tracker: SPSPStakesTracker;
    const startBlock = 14652905;
    const startTimestamp = 1650877705;

    const endBlock = 14722785;
    const endTimestamp = 1651829555;

    beforeAll(async () => {
      tracker = new SPSPStakesTracker();

      await tracker
        .setBlockBoundary({
          startBlock,
          endBlock,
          startTimestamp,
          endTimestamp,
        })
        .loadStakes();
    });

    test('Init state', () => {
      console.log(tracker.initState);
      expect(JSON.stringify(tracker.initState, BNReplacer, 2)).toMatchSnapshot(
        `SPSPStakesTracker::initState at block ${startBlock}`,
      );
    });

    test('Differential state', () => {
      expect(
        JSON.stringify(tracker.differentialStates, BNReplacer, 2),
      ).toMatchSnapshot(
        `SPSPStakesTracker::differentialState between block ${tracker.startBlock} and ${tracker.endBlock}`,
      );
    });
  });
  describe('Stability test to verify stakes compute exactly the same no matter when we start fetching', () => {
    let earlySPSPTracker: SPSPStakesTracker;
    let lateSPSPTracker: SPSPStakesTracker;
    let atObservationTracker: SPSPStakesTracker;

    const startBlockEarlyTracker = 14652905;
    const startTimestapEarlyTracker = 1650877705;

    const startBlockLateTracker = 14699930;
    const startTimestampLateTracker = 1651516627;

    const startBlockAtObservationTracker = 14722775; // matching observationTimestamp
    const observationTimestamp = 1651829438; // is matching startBlockAtObservationTracker

    const endBlockAllTrackers = startBlockAtObservationTracker + 1; // later than all but doesn't really matter much in future. Just after oberservation is fine
    const endTimestamp = 1651829444;

    assert(
      startBlockEarlyTracker < startBlockLateTracker &&
        startBlockLateTracker < startBlockAtObservationTracker &&
        startBlockAtObservationTracker < endBlockAllTrackers,
      'trackers start block should rigously follow : startBlockEarlyTracker < startBlockLateTracker < startBlockAtObservationTracker < endBlockBothTrackers',
    );

    beforeAll(async () => {
      earlySPSPTracker = new SPSPStakesTracker();
      lateSPSPTracker = new SPSPStakesTracker();
      atObservationTracker = new SPSPStakesTracker();

      await Promise.all([
        earlySPSPTracker
          .setBlockBoundary({
            startBlock: startBlockEarlyTracker,
            endBlock: endBlockAllTrackers,
            startTimestamp: startTimestapEarlyTracker,
            endTimestamp,
          })
          .loadStakes(),
        lateSPSPTracker
          .setBlockBoundary({
            startBlock: startBlockLateTracker,
            endBlock: endBlockAllTrackers,
            startTimestamp: startTimestampLateTracker,
            endTimestamp,
          })
          .loadStakes(),
        atObservationTracker
          .setBlockBoundary({
            startBlock: startBlockAtObservationTracker,
            startTimestamp: observationTimestamp,
            endBlock: endBlockAllTrackers,
            endTimestamp,
          })
          .loadStakes(),
      ]);
    });

    test(`Compare stakes of addresses on 3 different trackers`, () => {
      const addressesAtInitObservationTracker = Object.values(
        atObservationTracker.initState.sPSPBalanceByAccount,
      )
        .map(stakesForPool => Object.keys(stakesForPool))
        .flat();

      console.log(
        `Fetched ${addressesAtInitObservationTracker.length} addresses from just tracker started just before observation time`,
      );

      addressesAtInitObservationTracker.forEach(address => {
        const pspBalanceFromEarlyTracker =
          earlySPSPTracker.computeStakedPSPBalance(
            address,
            observationTimestamp,
          );

        const pspBalanceFromLateTracker =
          lateSPSPTracker.computeStakedPSPBalance(
            address,
            observationTimestamp,
          );

        const pspBalanceFromTrackerStartedAtObservationTime =
          atObservationTracker.computeStakedPSPBalance(
            address,
            observationTimestamp,
          );

        expect(
          pspBalanceFromEarlyTracker.isEqualTo(pspBalanceFromLateTracker),
        ).toBeTruthy();
        expect(
          pspBalanceFromEarlyTracker.isEqualTo(
            pspBalanceFromTrackerStartedAtObservationTime,
          ),
        ).toBeTruthy();
      });
    });
  });
  describe('virtual lockup - only stakes held for 7d preceding a transaction are taken into account', () => {
    const startBlock = 14305200;
    const startTimestamp = 1646192162;

    const endBlock = 15123160;
    const endTimestamp = 1657566578;

    let tracker: SPSPStakesTracker;

    beforeAll(async () => {
      tracker = new SPSPStakesTracker().setBlockBoundary({
        startBlock,
        startTimestamp,
        endBlock,
        endTimestamp,
      });

      await tracker.loadStakes();
    });

    test('account had stake for more than lockup_window and did a tx, whole stake is taken into account', () => {
      // enterWithPermit: https://etherscan.io/tx/0x76ebb2fcb750e16f086c9e75a1364d7f5355a283f49eda6c2845819df6d57b91
      // swap : https://polygonscan.com/tx/0x185ad8ff97fd92eedaa045722d65f487478887051e9402e2f1da699ffa92876f
      const txTimestamp = 1657396621;
      const account = '0x88f81b95eae67461b2d687343d36852f87409a7b';

      const actualStakeAtT = tracker.computeStakedPSPBalance(
        account,
        txTimestamp,
      );

      const virtuallyLockedStakeAtT =
        tracker.computeStakedPSPBalanceWithVirtualLockup(account, txTimestamp);

      expect(actualStakeAtT.isEqualTo(virtuallyLockedStakeAtT)).toBeTruthy();
    });

    test('account had no stake and staked within [t-lockup_window, t[ and did a new tx at t, no stake should be taken into account', () => {
      // enter : https://etherscan.io/tx/0x746c71e8bb678c26e58ef2c03e49adc4b4b1a6208a723772dad867da2cca8a87
      // swap : https://etherscan.io/tx/0x62aebdcfe527375fdfa0e87cdde482557febb330afe38b21c3143df936b621ae

      const txTimestamp = 1656366935;
      const account = '0x17134276ce356f3bacad4e2b23222d9a088ac248';

      const actualStakeAtT = tracker.computeStakedPSPBalance(
        account,
        txTimestamp,
      );

      const virtuallyLockedStakeAtT =
        tracker.computeStakedPSPBalanceWithVirtualLockup(account, txTimestamp);

      expect(actualStakeAtT.toFixed(0)).toBe('14596156936477148188887');
      expect(virtuallyLockedStakeAtT.toFixed(0)).toBe('0');
    });

    test('account had some stake and staked more within [t-lockup_window, t[ and did a new tx at t, take into account only part of stake held for last 7d', () => {
      // enter: https://etherscan.io/tx/0xdeed3257737726d250c5be4529f862f32d325b842b92cd179b1c4cae8b1930d4
      // swap: https://etherscan.io/tx/0xc9f96b1de35449efb4a64c1d2e1bbc008e95c3e4429c7bd4976087ce14917c95

      const txTimestamp = 1656430446;
      const account = '0x5577933afc0522c5ee71115df61512f49da0543e';

      const actualStakeAtT = tracker.computeStakedPSPBalance(
        account,
        txTimestamp,
      );

      const virtuallyLockedStakeAtT =
        tracker.computeStakedPSPBalanceWithVirtualLockup(account, txTimestamp);

      expect(virtuallyLockedStakeAtT.isLessThan(actualStakeAtT)).toBeTruthy();
      expect(actualStakeAtT.toFixed(0)).toBe('619217648752360328978270');
      expect(virtuallyLockedStakeAtT.toFixed(0)).toBe(
        '516526358541823114384937',
      );
    });

    test('account had some stake and withdrew a portion within [t-lockup_window, t[ and did a new tx at t, the actual stake should matching the minium held', () => {
      // leave: https://etherscan.io/tx/0x8123fabee2397ccd9a7071b0d58e0ef8fbe88bbbde3ee35131129c1b47064415
      // swap: https://etherscan.io/tx/0x7c32bf8707788598969d941e74df1a947be85a6482e3e779bc7113c5f013f0d1

      const txTimestamp = 1649168528;
      const account = '0x05537ac27aef02ee087ae859a73f2cc5fe15c798';

      const actualStakeAtT = tracker.computeStakedPSPBalance(
        account,
        txTimestamp,
      );

      const virtuallyLockedStakeAtT =
        tracker.computeStakedPSPBalanceWithVirtualLockup(account, txTimestamp);

      expect(actualStakeAtT.isEqualTo(virtuallyLockedStakeAtT)).toBeTruthy();
      expect(actualStakeAtT.toFixed(0)).not.toBe('0');
    });

    test('account had some stake and withdrew it all before tx, should not take into account any stake', () => {
      // leave: https://etherscan.io/tx/0x4211f53fa0f3cc931774d5b97aeaf118f0be0b862564819709d1cc3b9cb99b69
      // swap: https://etherscan.io/tx/0x06e55919991c52887b0958f21388505ff2585cf87939b5cb9cdf0bf7529b044b

      const txTimestamp = 1656515184;
      const account = '0x1d1ae55be3b5b4a0220eed418403cb3b2755e2b4';

      const actualStakeAtT = tracker.computeStakedPSPBalance(
        account,
        txTimestamp,
      );

      const virtuallyLockedStakeAtT =
        tracker.computeStakedPSPBalanceWithVirtualLockup(account, txTimestamp);

      expect(actualStakeAtT.isEqualTo(virtuallyLockedStakeAtT)).toBeTruthy();
      expect(actualStakeAtT.isZero()).toBeTruthy();
    });
  });
});
