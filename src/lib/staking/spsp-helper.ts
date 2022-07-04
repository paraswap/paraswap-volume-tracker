import BigNumber from 'bignumber.js';
import { Contract } from 'ethers';
import {
  CHAIN_ID_MAINNET,
  MulticallEncodedData,
  NULL_ADDRESS,
} from '../constants';
import { Provider } from '../provider';
import * as ERC20ABI from '../abi/erc20.abi.json';
import * as SPSPABI from '../abi/spsp.abi.json';
import * as MultiCallerABI from '../abi/multicaller.abi.json';
import { getTokenHolders } from '../utils/covalent';
import { PoolConfigsMap } from '../pool-info';
import { BNReplacer, ZERO_BN } from '../utils/helpers';
import {
  DataByAccountByPool,
  DataByPool,
  PSPStakesForStaker,
  SPSPStakesByAccount,
} from './types';
import { configLoader } from '../../config';

const logger = global.LOGGER('SPSPHelper');

const chainId = CHAIN_ID_MAINNET;
const provider = Provider.getJsonRpcProvider(chainId);

const config = configLoader.getConfig(CHAIN_ID_MAINNET);

export const SPSPAddresses = PoolConfigsMap[CHAIN_ID_MAINNET].filter(
  p => p.isActive,
).map(p => p.address.toLowerCase());

export class SPSPHelper {
  private static instance: SPSPHelper;

  static getInstance() {
    if (!SPSPHelper.instance) {
      SPSPHelper.instance = new SPSPHelper();
    }
    return SPSPHelper.instance;
  }

  chainId = CHAIN_ID_MAINNET; // all staking programs are only available on ethereum mainnet
  multicallContract: Contract;
  SPSPPrototypeContract: Contract;
  PSPContract: Contract;

  constructor() {
    this.multicallContract = new Contract(
      config.multicallV2Address,
      MultiCallerABI,
      provider,
    );

    this.SPSPPrototypeContract = new Contract(
      NULL_ADDRESS,
      SPSPABI,
      Provider.getJsonRpcProvider(this.chainId),
    );

    this.PSPContract = new Contract(
      config.pspAddress,
      ERC20ABI,
      Provider.getJsonRpcProvider(this.chainId),
    );
  }

  // function to fetch one staker data efficiently
  async getPSPStakedInSPSPs(
    account: string,
    blockNumber?: number,
  ): Promise<PSPStakesForStaker<string>> {
    const multicallData = SPSPAddresses.map(address => ({
      target: address,
      callData: this.SPSPPrototypeContract.interface.encodeFunctionData(
        'PSPBalance',
        [account],
      ),
    }));

    const rawResult: MulticallEncodedData =
      await this.multicallContract.functions.aggregate(multicallData, {
        blockTag: blockNumber,
      });

    const stakesByPool = Object.fromEntries(
      rawResult.returnData
        .map(
          (r, i) =>
            [
              SPSPAddresses[i],

              this.SPSPPrototypeContract.interface
                .decodeFunctionResult('PSPBalance', r)
                .toString(),
            ] as const,
        )
        .filter(([, stake]) => stake !== '0'),
    );

    const totalPSPStaked = Object.values(stakesByPool).reduce(
      (acc, stake) => acc + BigInt(stake),
      BigInt(0),
    );

    return {
      pspStaked: totalPSPStaked.toString(),
      breakdownByStakingContract: stakesByPool,
    };
  }

  /// functions to fetch multiple stakers data efficiently
  async fetchSPSPsState(blockNumber?: number): Promise<{
    totalSupplyByPool: DataByPool<BigNumber>;
    pspBalanceByPool: DataByPool<BigNumber>;
    pspsLockedByPool: DataByPool<BigNumber>;
  }> {
    logger.info(`Loading SPSP global states at block ${blockNumber}`);

    const totalSupplyByPool: DataByPool<BigNumber> = {};
    const pspBalanceByPool: DataByPool<BigNumber> = {};
    const pspsLockedByPool: DataByPool<BigNumber> = {};

    const multicallData = SPSPAddresses.flatMap(pool => [
      {
        target: pool,
        callData:
          this.SPSPPrototypeContract.interface.encodeFunctionData(
            'totalSupply',
          ),
      },
      {
        target: pool,
        callData:
          this.SPSPPrototypeContract.interface.encodeFunctionData('pspsLocked'),
      },
      {
        target: config.pspAddress,
        callData: this.PSPContract.interface.encodeFunctionData('balanceOf', [
          pool,
        ]),
      },
    ]);

    const rawResult = await this.multicallContract.functions.aggregate(
      multicallData,
      {
        blockTag: blockNumber,
      },
    );

    SPSPAddresses.forEach((pool, i) => {
      const totalSupply = this.SPSPPrototypeContract.interface
        .decodeFunctionResult('totalSupply', rawResult.returnData[3 * i])
        .toString();

      const pspsLocked = this.SPSPPrototypeContract.interface
        .decodeFunctionResult('pspsLocked', rawResult.returnData[3 * i + 1])
        .toString();

      const pspBalance = this.PSPContract.interface
        .decodeFunctionResult('balanceOf', rawResult.returnData[3 * i + 2])
        .toString();

      totalSupplyByPool[pool] = new BigNumber(totalSupply);
      pspBalanceByPool[pool] = new BigNumber(pspBalance);
      pspsLockedByPool[pool] = new BigNumber(pspsLocked);
    }, {});

    logger.info(`Completed loading SPSP global states at block ${blockNumber}`);

    return { totalSupplyByPool, pspBalanceByPool, pspsLockedByPool };
  }

  async fetchSPSPsStakers(
    blockNumber?: number,
  ): Promise<DataByAccountByPool<BigNumber>> {
    logger.info(
      `fetchSPSPsStakers: Loading sPSP balances at block ${blockNumber}`,
    );
    const sPSPBalanceByAccount = Object.fromEntries(
      await Promise.all(
        SPSPAddresses.map(async poolAddress => {
          // @WARNING pagination doesn't seem to work, so ask a large pageSize
          const options = {
            token: poolAddress,
            chainId: this.chainId,
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
      `fetchSPSPsStakers: Completed loading sPSP balances at block ${blockNumber}`,
    );

    return sPSPBalanceByAccount;
  }

  computePSPStakedInSPSP({
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

  async fetchPSPStakedInSPSP(blockNumber?: number): Promise<{
    totalPSPStaked: string;
    stakesByAccount: SPSPStakesByAccount<string>;
  }> {
    const [
      sPSPBalanceByAccountByPool,
      { totalSupplyByPool, pspBalanceByPool, pspsLockedByPool },
    ] = await Promise.all([
      this.fetchSPSPsStakers(blockNumber),
      this.fetchSPSPsState(blockNumber),
    ]);

    let totalPSPStaked = ZERO_BN;

    const stakesByAccount: SPSPStakesByAccount<BigNumber> = Object.entries(
      sPSPBalanceByAccountByPool,
    ).reduce<SPSPStakesByAccount<BigNumber>>(
      (acc, [poolAddress, stakesByAccountForPool]) => {
        const totalSupply = totalSupplyByPool[poolAddress];
        const pspBalance = pspBalanceByPool[poolAddress];
        const pspsLocked = pspsLockedByPool[poolAddress];

        Object.entries(stakesByAccountForPool).forEach(
          ([accountAddress, sPSPShare]) => {
            if (!acc[accountAddress]) {
              acc[accountAddress] = {
                totalPSPStakedAllSPSPS: new BigNumber(0),
                breakdownByStakingContract: {},
              };
            }

            const stakedPSP = this.computePSPStakedInSPSP({
              sPSPShare,
              pspBalance,
              pspsLocked,
              totalSPSP: totalSupply,
            }).decimalPlaces(0, BigNumber.ROUND_DOWN); // @TODO: move inside func but handle backward compat first

            acc[accountAddress].breakdownByStakingContract[poolAddress] =
              stakedPSP;

            acc[accountAddress].totalPSPStakedAllSPSPS =
              acc[accountAddress].totalPSPStakedAllSPSPS.plus(stakedPSP);

            totalPSPStaked = totalPSPStaked.plus(stakedPSP);
          },
        );

        return acc;
      },
      {},
    );

    const stringifiedStakesByAccount = JSON.stringify(
      stakesByAccount,
      BNReplacer,
    );

    return {
      totalPSPStaked: totalPSPStaked.toFixed(0),
      stakesByAccount: JSON.parse(stringifiedStakesByAccount),
    };
  }
}
