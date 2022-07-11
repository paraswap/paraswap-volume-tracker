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
});
