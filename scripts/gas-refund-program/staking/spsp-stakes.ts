import BigNumber from 'bignumber.js';
import {
  CHAIN_ID_MAINNET,
  MULTICALL_ADDRESS,
} from '../../../src/lib/constants';
import { PoolConfigsMap } from '../../../src/lib/pool-info';
import { Provider } from '../../../src/lib/provider';
import { getTokenHolders } from './covalent';
import * as MultiCallerABI from '../../../src/lib/abi/multicaller.abi.json';
import * as SPSPABI from '../../../src/lib/abi/spsp.abi.json';
import { Contract } from 'ethers';
import { Interface } from '@ethersproject/abi';
import { StakedPSPByAddress } from '../types';
import * as pLimit from 'p-limit';
import * as pMemoize from 'p-memoize';
import * as QuickLRU from 'quick-lru';

interface GetStakersForPoolsInput {
  pools: string[];
  chainId: number;
  blockNumber: number;
}

interface PoolWithStakers {
  pool: string;
  chainId: number;
  stakers: {
    staker: string;
    sPSPbalance: string;
  }[];
}

async function getStakersForPools({
  pools,
  chainId,
  blockNumber,
}: GetStakersForPoolsInput): Promise<PoolWithStakers[]> {
  if (pools.length == 0) return [];

  const tokenHoldersAndPools = await Promise.all(
    pools.map(async pool => {
      // @WARNING pagination doesn't seem to work, so ask a large pageSize
      const options = {
        pageSize: 10000,
        token: pool,
        chainId,
        blockHeight: String(blockNumber),
      };

      const { items } = await getTokenHolders(options);

      const stakers = items.map(item => ({
        staker: item.address,
        sPSPbalance: item.balance, // wei
      }));

      const result = {
        pool,
        chainId,
        stakers,
      };

      return result;
    }),
  );

  return tokenHoldersAndPools;
}

const sPSPInterface = new Interface(SPSPABI);

const ONE_UNIT = (10 ** 18).toString();

type PSPRateByPool = { [poolAddess: string]: number };

async function getSPSPToPSPRatesByPool({
  pools,
  chainId,
  blockNumber,
}: {
  pools: string[];
  chainId: number;
  blockNumber: number;
}): Promise<PSPRateByPool> {
  const provider = Provider.getJsonRpcProvider(chainId);
  const multicallContract = new Contract(
    MULTICALL_ADDRESS[chainId],
    MultiCallerABI,
    provider,
  );
  const multicallData = pools.map(pool => ({
    target: pool,
    callData: sPSPInterface.encodeFunctionData('PSPForSPSP', [ONE_UNIT]),
  }));

  const rawResult = await multicallContract.functions.aggregate(multicallData, {
    blockTag: blockNumber,
  });

  const pspRatesByPool = pools.reduce<PSPRateByPool>((acc, pool, i) => {
    const pspForOneSPS = sPSPInterface
      .decodeFunctionResult('PSPForSPSP', rawResult.returnData[i])
      .toString();

    acc[pool] = new BigNumber(pspForOneSPS).dividedBy(ONE_UNIT).toNumber();

    return acc;
  }, {});

  return pspRatesByPool;
}

const spspMulticallLimit = pLimit(5);

const getSPSPToPSPRatesByPoolCached = pMemoize(getSPSPToPSPRatesByPool, {
  cacheKey: args => `${args[0].chainId}_${args[0].blockNumber}`,
  cache: new QuickLRU({
    maxSize: 500, // cache up to 500 block numbers
  }),
});

export async function getSPSPStakes({
  blockNumber,
}: {
  blockNumber: number;
}): Promise<StakedPSPByAddress | null> {
  const chainId = CHAIN_ID_MAINNET;

  const SPSPs = PoolConfigsMap[chainId]
    .filter(p => p.isActive)
    .map(p => p.address);

  const [stakersByPool, spspToPSPRateByPool] = await Promise.all([
    getStakersForPools({
      pools: SPSPs,
      chainId,
      blockNumber,
    }),
    spspMulticallLimit(() =>
      getSPSPToPSPRatesByPoolCached({
        pools: SPSPs,
        chainId,
        blockNumber,
      }),
    ),
  ]);

  if (!spspToPSPRateByPool) return null;

  const pspStakes = stakersByPool.reduce<StakedPSPByAddress>((acc, pool) => {
    const rate = spspToPSPRateByPool[pool.pool];

    pool.stakers.forEach(staker => {
      const accStakes = new BigNumber(acc[staker.staker] || 0);

      acc[staker.staker] = accStakes
        .plus(new BigNumber(staker.sPSPbalance).multipliedBy(rate))
        .toFixed(0);
    });

    return acc;
  }, {});

  return pspStakes;
}
