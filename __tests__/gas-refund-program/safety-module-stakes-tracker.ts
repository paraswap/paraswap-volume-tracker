import '../../src/lib/log4js';
import * as dotenv from 'dotenv';
dotenv.config();
import SafetyModuleStakeTracker from '../../scripts/gas-refund-program/staking/safety-module-stakes-tracker';
import { serialiseTimeSeriesValues } from '../../scripts/gas-refund-program/timeseries';

describe('SafetyModuleStakesTracker', () => {
  let tracker: SafetyModuleStakeTracker;
  const startBlock = 14567000;

  beforeAll(async () => {
    tracker = new SafetyModuleStakeTracker();
    tracker.setBlockBoundary(startBlock + 1, startBlock + 10000);
    await tracker.loadStakes();
  });

  test('Init state', () => {
    // hint: Use https://etherscan.io/tokencheck-tool to check all snapshoted data
    const initStateSerialised = {
      bptPoolPSPBalance: tracker.initState.bptPoolPSPBalance.toString(), // hint: given by balancer vault by looking at getPoolTokenInfo() - execute rpc call at specific block
      bptPoolTotalSupply: tracker.initState.bptPoolTotalSupply.toString(), // hint: check total supply of 0xcb0e14e96f2cefa8550ad8e4aea344f211e5061d at block
      stkPSPBptUsersBalances: Object.fromEntries(
        // hint: check balances of 0xc8dc2ec5f5e02be8b37a8444a1931f02374a17ab of users at blocl
        Object.entries(tracker.initState.stkPSPBptUsersBalances).map(
          ([key, value]) => [key, value.toString()] as const,
        ),
      ),
    };

    expect(initStateSerialised).toMatchSnapshot(
      `SafetyModuleStakesTracker::initState at block ${startBlock}`,
    );
  });

  test('Differential state', () => {
    const differentialStateSerialised = {
      // hint: observe balancer's vault PoolBalanceChanged + Swap event for 80PSP-20WETH Pool (bptPool)
      bptPoolPSPBalance: serialiseTimeSeriesValues(
        tracker.differentialStates.bptPoolPSPBalance,
      ),
      // hint: observe Mint (transfer zero address) / Burn (transfer to zero address) events for 80PSP-20WETH Pool (bptPool)
      bptPoolTotalSupply: serialiseTimeSeriesValues(
        tracker.differentialStates.bptPoolTotalSupply,
      ),
      // hint: observe any Transfer event forr safetyMpdume
      stkPSPBptUsersBalances: Object.fromEntries(
        // hint: check Transfers event of 0xc8dc2ec5f5e02be8b37a8444a1931f02374a17ab of users
        Object.entries(tracker.differentialStates.stkPSPBptUsersBalances).map(
          ([account, timeseries]) =>
            [account, serialiseTimeSeriesValues(timeseries)] as const,
        ),
      ),
    };

    expect(differentialStateSerialised).toMatchSnapshot(
      `SafetyModuleStakesTracker::differentialState between block ${tracker.startBlock} and ${tracker.endBlock}`,
    );
  });

  test('Staked PSP Balance at timestamp', () => {
    const pspBalanceAtTimestamp = tracker.computeStakedPSPBalance(
      '0x0e71f7a6bbae357a1cd364173ae69d3fb2e539e3',
      1649822860, // timestamp has to be within range
    );

    // hint: verify by computing data for earlier timestamp and compare staked balance with dapps like zerion or debank
    expect(pspBalanceAtTimestamp.toString()).toBe('31176610680399907896512');
  });
});
