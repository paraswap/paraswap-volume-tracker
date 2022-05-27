import BigNumber from 'bignumber.js';
import { Contract } from 'ethers';
import {
  CHAIN_ID_MAINNET,
  MulticallEncodedData,
  MULTICALL_ADDRESS,
  NULL_ADDRESS,
  PSP_ADDRESS,
} from '../constants';
import { Provider } from '../provider';
import * as ERC20ABI from '../abi/erc20.abi.json';
import * as SPSPABI from '../abi/spsp.abi.json';
import * as MultiCallerABI from '../abi/multicaller.abi.json';
import { getTokenHolders } from '../utils/covalent';
import { PoolConfigsMap } from '../pool-info';
import { BNReplacer, ZERO_BN } from '../utils/helpers';

const logger = global.LOGGER('SPSPHelper');

const chainId = CHAIN_ID_MAINNET;
const provider = Provider.getJsonRpcProvider(chainId);

export const SPSPAddresses = PoolConfigsMap[CHAIN_ID_MAINNET].filter(
  p => p.isActive,
).map(p => p.address.toLowerCase());

const multicallContract = new Contract(
  MULTICALL_ADDRESS[chainId],
  MultiCallerABI,
  provider,
);

const SPSPPrototypeContract = new Contract(
  NULL_ADDRESS,
  SPSPABI,
  Provider.getJsonRpcProvider(CHAIN_ID_MAINNET),
);

const PSPContract = new Contract(
  PSP_ADDRESS[CHAIN_ID_MAINNET],
  ERC20ABI,
  Provider.getJsonRpcProvider(CHAIN_ID_MAINNET),
);

type DataByPool<T> = {
  [poolAddress: string]: T;
};

type DataByAccountByPool<T> = {
  [poolAddress: string]: {
    [accountAddress: string]: T;
  };
};

// function to fetch one staker data efficiently
export async function getPSPStakedInSPSPs(account: string): Promise<bigint> {
  const multicallData = SPSPAddresses.map(address => ({
    target: address,
    callData: SPSPPrototypeContract.interface.encodeFunctionData('PSPBalance', [
      account,
    ]),
  }));

  const rawResult: MulticallEncodedData =
    await multicallContract.functions.aggregate(multicallData);

  const allStakes = rawResult.returnData.map(r =>
    BigInt(
      SPSPPrototypeContract.interface
        .decodeFunctionResult('PSPBalance', r)
        .toString(),
    ),
  );

  const totalStakes = allStakes.reduce((acc, curr) => acc + curr, BigInt(0));

  return totalStakes;
}

/// functions to fetch multiple stakers data efficiently

export async function fetchSPSPsState(blockNumber?: number): Promise<{
  totalSupplyByPool: DataByPool<BigNumber>;
  pspBalanceByPool: DataByPool<BigNumber>;
  pspsLockedByPool: DataByPool<BigNumber>;
}> {
  logger.info(`Loading initial SPSP global states at block ${blockNumber}`);

  const totalSupplyByPool: DataByPool<BigNumber> = {};
  const pspBalanceByPool: DataByPool<BigNumber> = {};
  const pspsLockedByPool: DataByPool<BigNumber> = {};

  const multicallData = SPSPAddresses.flatMap(pool => [
    {
      target: pool,
      callData:
        SPSPPrototypeContract.interface.encodeFunctionData('totalSupply'),
    },
    {
      target: pool,
      callData:
        SPSPPrototypeContract.interface.encodeFunctionData('pspsLocked'),
    },
    {
      target: PSP_ADDRESS[chainId],
      callData: PSPContract.interface.encodeFunctionData('balanceOf', [pool]),
    },
  ]);

  const rawResult = await multicallContract.functions.aggregate(multicallData, {
    blockTag: blockNumber,
  });

  SPSPAddresses.forEach((pool, i) => {
    const totalSupply = SPSPPrototypeContract.interface
      .decodeFunctionResult('totalSupply', rawResult.returnData[3 * i])
      .toString();

    const pspsLocked = SPSPPrototypeContract.interface
      .decodeFunctionResult('pspsLocked', rawResult.returnData[3 * i + 1])
      .toString();

    const pspBalance = PSPContract.interface
      .decodeFunctionResult('balanceOf', rawResult.returnData[3 * i + 2])
      .toString();

    totalSupplyByPool[pool] = new BigNumber(totalSupply);
    pspBalanceByPool[pool] = new BigNumber(pspBalance);
    pspsLockedByPool[pool] = new BigNumber(pspsLocked);
  }, {});

  logger.info(
    `Completed loading initial SPSP global states at block ${blockNumber}`,
  );

  return { totalSupplyByPool, pspBalanceByPool, pspsLockedByPool };
}

export async function fetchSPSPsStakers(
  blockNumber?: number,
): Promise<DataByAccountByPool<BigNumber>> {
  const chainId = CHAIN_ID_MAINNET;

  logger.info(
    `fetchSPSPsStakers: Loading initial sPSP balances at block ${blockNumber}`,
  );
  const sPSPBalanceByAccount = Object.fromEntries(
    await Promise.all(
      SPSPAddresses.map(async poolAddress => {
        // @WARNING pagination doesn't seem to work, so ask a large pageSize
        const options = {
          token: poolAddress,
          chainId,
          ...(!!blockNumber && { blockHeight: String(blockNumber) }),
        };

        const stakes = await getTokenHolders(options);

        const stakesByAccount = Object.fromEntries(
          stakes.map(
            item =>
              [
                item.address,
                new BigNumber(item.balance), // wei
              ] as const,
          ),
        );

        return [poolAddress, stakesByAccount] as const;
      }),
    ),
  );
  logger.info(
    `fetchSPSPsStakers: Completed loading initial sPSP balances at block ${blockNumber}`,
  );

  return sPSPBalanceByAccount;
}

export function computePSPStakedInSPSP({
  sPSPShare,
  pspBalance,
  pspsLocked,
  totalSPSP,
}: {
  sPSPShare: BigNumber;
  pspBalance: BigNumber;
  pspsLocked: BigNumber;
  totalSPSP: BigNumber;
}): BigNumber {
  const pspBalanceAvailable = pspBalance.minus(pspsLocked);

  const stakedPSPBalance = sPSPShare
    .multipliedBy(pspBalanceAvailable)
    .dividedBy(totalSPSP);

  return stakedPSPBalance;
}

type StakesByAccount<T> = {
  [accountAddress: string]: {
    totalPSPStakedAllSPSPS: T;
    totalPSPStakedBySPSP: DataByPool<T>;
  };
};
export async function fetchPSPStakedInSPSP(blockNumber?: number): Promise<{
  totalPSPStaked: string;
  stakesByAccount: StakesByAccount<string>;
}> {
  const [
    sPSPBalanceByAccountByPool,
    { totalSupplyByPool, pspBalanceByPool, pspsLockedByPool },
  ] = await Promise.all([
    fetchSPSPsStakers(blockNumber),
    fetchSPSPsState(blockNumber),
  ]);

  let totalPSPStaked = ZERO_BN;

  const stakesByAccount: StakesByAccount<BigNumber> = Object.entries(
    sPSPBalanceByAccountByPool,
  ).reduce<StakesByAccount<BigNumber>>(
    (acc, [poolAddress, stakesByAccountForPool]) => {
      const totalSupply = totalSupplyByPool[poolAddress];
      const pspBalance = pspBalanceByPool[poolAddress];
      const pspsLocked = pspsLockedByPool[poolAddress];

      Object.entries(stakesByAccountForPool).forEach(
        ([accountAddress, sPSPShare]) => {
          if (!acc[accountAddress]) {
            acc[accountAddress] = {
              totalPSPStakedAllSPSPS: new BigNumber(0),
              totalPSPStakedBySPSP: {},
            };
          }

          const stakedPSP = computePSPStakedInSPSP({
            sPSPShare,
            pspBalance,
            pspsLocked,
            totalSPSP: totalSupply,
          }).decimalPlaces(0); // @TODO: move inside func when sure about backward compat with script

          acc[accountAddress].totalPSPStakedBySPSP[poolAddress] = stakedPSP;

          acc[accountAddress].totalPSPStakedAllSPSPS =
            acc[accountAddress].totalPSPStakedAllSPSPS.plus(stakedPSP);

          totalPSPStaked = totalPSPStaked.plus(stakedPSP);
        },
      );

      return acc;
    },
    {},
  );

  const partiallySerStakesByAccount = JSON.stringify(
    stakesByAccount,
    BNReplacer,
  );

  return {
    totalPSPStaked: totalPSPStaked.toFixed(0),
    stakesByAccount: JSON.parse(partiallySerStakesByAccount),
  };
}
