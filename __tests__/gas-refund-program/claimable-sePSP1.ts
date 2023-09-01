import '../../src/lib/log4js';
import * as dotenv from 'dotenv';
dotenv.config();
import { ClaimableSePSP1StateTracker } from '../../scripts/gas-refund-program/staking/2.0/ClaimableSePSP1StateTracker';
import { assert } from 'ts-essentials';
import { BNReplacer, fetchBlocksTimestamps } from '../../src/lib/utils/helpers';
import { CHAIN_ID_MAINNET } from '../../src/lib/constants';

jest.setTimeout(5 * 60 * 1000);

describe('claimable sePSP1', () => {
  describe('assert correct sePSP1 balance', () => {
    test(`check balance before and after claiming`, async () => {
      const chainId = CHAIN_ID_MAINNET;
      // check the users' distribution in epoch 32 that https://gateway.pinata.cloud/ipfs/QmfJzuZp5rU9KedFAJ6zUfst91axqqgCAw28zjmsmk8GFX?_gl=1*118tlu9*_ga*YmFhNzhiNjgtZmFlZS00YzQ2LWIyMGEtODhmM2E2MTU2NDMx*_ga_5RMPXG14TE*MTY4MDAyNzA2Ni4xLjEuMTY4MDAyNzM5NS40Mi4wLjA
      const account =
        '0x81ea04c179b82d31662994a68b2582ad9d860f88'.toLowerCase();
      const expectedBalanceBeforeClaiming = '9600590019728165302535';
      const blockAtWhichUnstakeHappened = 16932447; // https://etherscan.io/tx/0x19b05ed3fdc51295af2fe09aa10bfe9b6a77667002bccc6d20190fdcafe85ab2

      // the interval is within epoch 33 (after epoch 32 sePSP1 has been distributed)
      const startBlock = blockAtWhichUnstakeHappened - 1;
      const endBlock = blockAtWhichUnstakeHappened + 1;

      const claimableSePSP1Tracker = new ClaimableSePSP1StateTracker(chainId);
      const timestampByBlock = await fetchBlocksTimestamps({
        chainId,
        blockNumbers: [startBlock, endBlock],
      });
      const startTimestamp = timestampByBlock[startBlock];
      const endTimestamp = timestampByBlock[endBlock];

      claimableSePSP1Tracker.setBlockTimeBoundary({
        startBlock,
        endBlock,
        startTimestamp,
        endTimestamp,
      });

      await claimableSePSP1Tracker.loadStates();

      const balanceBeforeClaim = claimableSePSP1Tracker.getBalance(
        startTimestamp,
        account,
      );
      const balanceAfterClaim = claimableSePSP1Tracker.getBalance(
        endTimestamp,
        account,
      );

      expect(
        balanceBeforeClaim.isEqualTo(expectedBalanceBeforeClaiming),
      ).toBeTruthy();

      expect(balanceAfterClaim.isZero()).toBeTruthy();
    });
  });
});
