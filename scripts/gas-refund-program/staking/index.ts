import BigNumber from 'bignumber.js';
import { CHAIN_ID_MAINNET } from '../../../src/lib/constants';
import { fetchSafetyModuleStakes } from './safety-module-stakes';
import { fetchSPSStakes } from './spsp-stakes';
import { getBlockAfterTimeStamp } from '../blocks-subgraph';

export async function fetchUserStakes({
  account,
  timestamp,
  blockNumber,
}: {
  account: string;
  timestamp: number;
  blockNumber?: number;
}): Promise<BigNumber> {
  const chainId = CHAIN_ID_MAINNET; // sPSP + safety module are only available on ethereum

  const _blockNumber = blockNumber
    ? blockNumber
    : await getBlockAfterTimeStamp(chainId, timestamp);

  const usersStakes = (
    await Promise.all(
      [fetchSPSStakes, fetchSafetyModuleStakes].map(f =>
        f({
          account,
          blockNumber: _blockNumber,
          chainId,
        }),
      ),
    )
  ).reduce((acc, stakes) => acc.plus(stakes), new BigNumber(0));

  return usersStakes;
}
