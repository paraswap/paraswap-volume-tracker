import { PoolConfigsMap } from "../../lib/pool-info";
import { getTokenHolders } from "./covalent";

interface GetStakersForPoolsInput {
  pools: string[]
  blockHeight?: string
  chainId: number
}

interface PoolWithStakers {
  pool: string;
  chainId: number;
  blockHeight: string | undefined;
  stakers: {
    staker: string;
    sPSPbalance: string;
  }[];
}

async function getStakersForPools({ pools, chainId, blockHeight }: GetStakersForPoolsInput): Promise<PoolWithStakers[]> {
  if (pools.length == 0) return []

  const tokenHoldersAndPools = await Promise.all(pools.map(async pool => {
    // @WARNING pagination doesn't seem to work, so ask a large pageSize
    const options = { pageSize: 10000, blockHeight, token: pool, chainId }

    const { items } = await getTokenHolders(options)

    const stakers = items.map(item => ({
      staker: item.address,
      sPSPbalance: item.balance, // wei
    }))

    const result = {
      pool,
      chainId,
      blockHeight,
      stakers
    }

    return result
  }))

  return tokenHoldersAndPools
}

export function getStakersForChainId(chainId: number, blockHeight?: string): Promise<PoolWithStakers[]> {
  const SPSPs = PoolConfigsMap[chainId].filter(p => p.isActive).map(
    p => p.address,
  );

  // @TODO get sPSP to PSP rate per pool, pass to getStakersForPools and calc stakedPSP
  // then compose map {staker => stakedPSP}


  return getStakersForPools({ pools: SPSPs, chainId, blockHeight })
}