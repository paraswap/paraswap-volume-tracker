import '../../src/lib/log4js';
import * as dotenv from 'dotenv';
dotenv.config();
import SPSPStakesTracker from '../../scripts/gas-refund-program/staking/spsp-stakes-tracker';
import { assert } from 'ts-essentials';

jest.setTimeout(5 * 60 * 1000);

describe('SpspStakesTracker', () => {
  describe('Stability test to verify stakes compute exactly the same no matter when we start fetching', () => {
    let earlySPSPTracker: SPSPStakesTracker;
    let lateSPSPTracker: SPSPStakesTracker;
    let atObservationTracker: SPSPStakesTracker;

    let observationTimestamp = 1651829438; // is matching startBlockAtObservationTracker

    let startBlockEarlyTracker = 14652905;
    let startBlockLateTracker = 14699930;
    let startBlockAtObservationTracker = 14722775; // matching observationTimestamp
    let endBlockAllTrackers = startBlockAtObservationTracker + 1; // later than all but doesn't really matter much in future. Just after oberservation is fine

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
          .setBlockBoundary(startBlockEarlyTracker, endBlockAllTrackers)
          .loadStakes(),
        lateSPSPTracker
          .setBlockBoundary(startBlockLateTracker, endBlockAllTrackers)
          .loadStakes(),
        atObservationTracker
          .setBlockBoundary(startBlockAtObservationTracker, endBlockAllTrackers)
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
