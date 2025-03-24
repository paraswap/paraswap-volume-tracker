import { STAKING_CHAIN_IDS } from '../constants';

import { TimeSeries } from '../../../scripts/gas-refund-program/timeseries';
import { grp2ConfigByChain } from '../gas-refund/config';
import { assert } from 'ts-essentials';
import { Contract } from 'ethers';
import * as ERC20ABI from '../../../src/lib/abi/erc20.abi.json';
import { Provider } from '../provider';
import BigNumber from 'bignumber.js';
import { BPTHelper } from '../../../scripts/gas-refund-program/staking/2.0/BPTHelper';
import { BlockInfo } from '../block-info';
import {
  MerkleData,
  MerkleRedeemHelperSePSP1,
} from '../../../scripts/gas-refund-program/staking/2.0/MerkleRedeemHelperSePSP1';

import { ClaimableSePSP1StateTracker } from '../../../scripts/gas-refund-program/staking/2.0/ClaimableSePSP1StateTracker';
import { resolveV2EpochNumber } from '../gas-refund/epoch-helpers';

type ConstructClaimableSePSP1DataResult = {
  claimsTimeseriesByStakeChainId: Record<number, TimeSeries>;
  usersAccumulatedDistributedSePSP1BuStakeChainId: Record<number, bigint>;
  allUsersDistributionsByChainId: Record<number, MerkleData[]>;
};

async function constructClaimableSePSP1Data(
  user: string,
  _epoch: number,
): Promise<ConstructClaimableSePSP1DataResult> {
  const claimsTimeseriesByStakeChainId = Object.fromEntries(
    await Promise.all(
      STAKING_CHAIN_IDS.map(async stakeChainId => {
        const timeseriesAllAccounts =
          await ClaimableSePSP1StateTracker.getInstance(
            stakeChainId,
          ).getClaimsFromEpoch32ToStartEpoch();
        const usersTimeseries = timeseriesAllAccounts[user] || [];

        return [stakeChainId, usersTimeseries];
      }),
    ),
  );

  // debugger;

  const merkleTreeData =
    await MerkleRedeemHelperSePSP1.getInstance().getMerkleDataByEpochWithCacheKey();
  const allSePSP1Distributions = Object.entries(
    merkleTreeData.merkleDataByEpoch,
  ).filter(([epoch, merkleData]) => Number(epoch) < _epoch);

  const allUsersDistributions = allSePSP1Distributions
    .map(([epoch, merkleData]) =>
      merkleData.merkleProofs.filter(
        proof => proof.address.toLowerCase() === user.toLowerCase(),
      ),
    )
    .flat();

  const usersAccumulatedDistributedSePSP1 = allUsersDistributions.reduce(
    (acc, proof) => {
      return acc + BigInt(proof.amount);
    },
    BigInt(0),
  );

  return {
    claimsTimeseriesByStakeChainId,
    usersAccumulatedDistributedSePSP1BuStakeChainId: {
      1: usersAccumulatedDistributedSePSP1,
      10: BigInt(0), // @TODO: adjust for optimism
    },
    allUsersDistributionsByChainId: {
      1: allUsersDistributions,
      10: [], // @TODO: adjust for optimism
    },
  };
}

async function getBlocknumberByTimestamp(timestamp: number, chainId: number) {
  return BlockInfo.getInstance(chainId).getBlockAfterTimeStamp(timestamp);
}

function getClaimableSePSP1AtTimestamp(
  timestamp: number,
  claimsTimeseries: TimeSeries,
  usersAccumulatedDistributedSePSP1: bigint,
) {
  const filteredTimeSeries = claimsTimeseries.filter(
    ({ timestamp: claimTimestamp }) => claimTimestamp <= timestamp,
  );
  const claimableSePSP1AtTimestamp = filteredTimeSeries.reduce(
    (acc, { timestamp: claimTimestamp, value }) =>
      acc + BigInt(value.toFixed()),
    usersAccumulatedDistributedSePSP1,
  );

  return claimableSePSP1AtTimestamp;
}
async function getERC20Balance(
  contract: string,
  user: string,
  chainId: number,
  blockTag: string | number,
) {
  const erc20Contract = new Contract(
    contract,
    ERC20ABI,
    Provider.getJsonRpcProvider(chainId),
  );

  const balance = await erc20Contract.balanceOf(user, { blockTag });
  return BigInt(balance.toString() || '0');
}

async function fetchDebugDataByStakeId(
  timestamp: number,
  account: any,
  claimsTimeseriesByStakeChainId: Record<number, TimeSeries>,
  usersAccumulatedDistributedSePSP1BuStakeChainId: Record<number, bigint>,
): Promise<any> {
  return Object.fromEntries(
    await Promise.all(
      STAKING_CHAIN_IDS.map(async stakeChainId => {
        const stackeChainBlocknumber = await getBlocknumberByTimestamp(
          timestamp,
          stakeChainId,
        );
        assert(stackeChainBlocknumber, 'blocknumber not found');

        const sePSP1Address = grp2ConfigByChain[stakeChainId].sePSP1;
        const sePSP2Address = grp2ConfigByChain[stakeChainId].sePSP2;

        const [
          sePSP1BalanceAtTimestamp,
          sePSP2BalanceAtTimestamp,
          bptStateAtTimestamp,
        ] = await Promise.all([
          getERC20Balance(
            sePSP1Address,
            account,
            stakeChainId,
            stackeChainBlocknumber,
          ),
          getERC20Balance(
            sePSP2Address,
            account,
            stakeChainId,
            stackeChainBlocknumber,
          ),
          await BPTHelper.getInstance(stakeChainId).fetchBPtState(
            stackeChainBlocknumber,
          ),
        ]);

        const claimableSePSP1AtTimestamp = getClaimableSePSP1AtTimestamp(
          timestamp,
          claimsTimeseriesByStakeChainId[stakeChainId],
          usersAccumulatedDistributedSePSP1BuStakeChainId[stakeChainId],
        );

        const pspInSePSP2 = new BigNumber(sePSP2BalanceAtTimestamp.toString())
          .multipliedBy(bptStateAtTimestamp.pspBalance)
          .dividedBy(bptStateAtTimestamp.bptTotalSupply)
          .decimalPlaces(0, BigNumber.ROUND_DOWN);

        return [
          stakeChainId,
          {
            sePSP1BalanceAtTimestamp: sePSP1BalanceAtTimestamp.toString(),
            sePSP2BalanceAtTimestamp: sePSP2BalanceAtTimestamp.toString(),
            bptStateAtTimestamp: {
              pspBalance: bptStateAtTimestamp.pspBalance.toFixed(),
              ethBalance: bptStateAtTimestamp.ethBalance.toFixed(),
              totalSupply: bptStateAtTimestamp.bptTotalSupply.toFixed(),
            },
            claimableSePSP1AtTimestamp: claimableSePSP1AtTimestamp.toString(),
            computedChainStakeScore: (
              sePSP1BalanceAtTimestamp +
              claimableSePSP1AtTimestamp +
              BigInt(pspInSePSP2.multipliedBy(2.5).toFixed(0))
            ).toString(),
          },
        ];
      }),
    ),
  );
}

export async function fetchUserDebugData(user: string, timestamp: number) {
  const _epoch = resolveV2EpochNumber(timestamp);
  const {
    claimsTimeseriesByStakeChainId,
    usersAccumulatedDistributedSePSP1BuStakeChainId,
  } = await constructClaimableSePSP1Data(user, _epoch);

  const data = await fetchDebugDataByStakeId(
    timestamp,
    user,
    claimsTimeseriesByStakeChainId,
    usersAccumulatedDistributedSePSP1BuStakeChainId,
  );

  return data;
}
