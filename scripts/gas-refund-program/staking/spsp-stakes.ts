import { Interface } from '@ethersproject/abi';
import BigNumber from 'bignumber.js';
import {
  CHAIN_ID_MAINNET,
  MULTICALL_ADDRESS,
} from '../../../src/lib/constants';
import { PoolConfigsMap } from '../../../src/lib/pool-info';
import { Provider } from '../../../src/lib/provider';
import * as MultiCallerABI from '../../../src/lib/abi/multicaller.abi.json';
import * as SPSPABI from '../../../src/lib/abi/spsp.abi.json';
import { rpcCallConcurrencyLimited, ZERO_BN } from '../utils';
import { Contract } from 'ethers';
import { StakesFetcher } from './types';
import { getTokenBalance } from './covalent';

const sPSPInterface = new Interface(SPSPABI);

const SPSPs = PoolConfigsMap[CHAIN_ID_MAINNET].filter(p => p.isActive).map(
  p => p.address,
);

const provider = Provider.getJsonRpcProvider(CHAIN_ID_MAINNET);

const multicallContract = new Contract(
  MULTICALL_ADDRESS[CHAIN_ID_MAINNET],
  MultiCallerABI,
  provider,
);

export const fetchSPSStakes: StakesFetcher = async ({
  account,
  blockNumber,
  chainId,
}) => {
  // fetch via covalent to rely on fast/cheap readonly chain data infrastructure
  const sPSPBalancesByPool = Object.fromEntries(
    await Promise.all(
      SPSPs.map(
        async pool =>
          [
            pool,
            await getTokenBalance({
              token: pool,
              address: account,
              blockHeight: String(blockNumber),
              chainId,
            }),
          ] as const,
      ),
    ),
  );

  if (Object.values(sPSPBalancesByPool).every(balance => balance.isZero())) {
    return ZERO_BN;
  }

  const sPSPSWithBalance = SPSPs.filter(
    pool => !sPSPBalancesByPool[pool].isZero(),
  );

  const multicallData = sPSPSWithBalance.map(pool => ({
    target: pool,
    callData: sPSPInterface.encodeFunctionData('PSPBalance', [account]),
  }));

  const rawResult = await rpcCallConcurrencyLimited(() =>
    multicallContract.functions.aggregate(multicallData, {
      blockTag: blockNumber,
    }),
  );

  const totalPSPBalance = sPSPSWithBalance.reduce<BigNumber>((acc, _, i) => {
    const pspBalance = sPSPInterface
      .decodeFunctionResult('PSPBalance', rawResult.returnData[i])
      .toString();

    return acc.plus(new BigNumber(pspBalance));
  }, new BigNumber(0));

  return totalPSPBalance;
};
