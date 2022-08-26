import * as ERC20ABI from '../abi/erc20.abi.json';
import * as BVaultABI from '../abi/balancer-vault.abi.json';
import * as MultiCallerABI from '../abi/multicaller.abi.json';
import {
  BalancerVaultAddress,
  Balancer_80PSP_20WETH_address,
  Balancer_80PSP_20WETH_poolId,
  CHAIN_ID_MAINNET,
  MulticallEncodedData,
  MULTICALL_ADDRESS,
  PSP_ADDRESS,
  SAFETY_MODULE_ADDRESS,
} from '../constants';
import { Provider } from '../provider';
import { Contract, BigNumber as EthersBN } from 'ethers';
import { Interface } from '@ethersproject/abi';
import { getTokenHolders } from '../utils/covalent';
import { DataByAccount, PSPStakesForStaker, StkPSPBPtState } from './types';

export class SafetyModuleHelper {
  private static instance: SafetyModuleHelper;

  static getInstance() {
    if (!SafetyModuleHelper.instance) {
      SafetyModuleHelper.instance = new SafetyModuleHelper();
    }
    return SafetyModuleHelper.instance;
  }

  chainId = CHAIN_ID_MAINNET; // all staking programs are only available on ethereum mainnet
  multicallContract: Contract;
  safetyModuleAsERC20: Contract;
  bVaultIface: Interface;
  erc20Iface: Interface;

  constructor() {
    const provider = Provider.getJsonRpcProvider(this.chainId);

    this.multicallContract = new Contract(
      MULTICALL_ADDRESS[this.chainId],
      MultiCallerABI,
      provider,
    );

    this.safetyModuleAsERC20 = new Contract(
      SAFETY_MODULE_ADDRESS,
      ERC20ABI,
      provider,
    );

    this.bVaultIface = new Interface(BVaultABI);
    this.erc20Iface = new Interface(ERC20ABI);
  }

  // this computes the staked PSP in the safety module for one account. This method is safe regarding to slashing.
  getPSPStakedInSafetyModule = async (
    account: string,
    blockNumber?: number,
  ): Promise<PSPStakesForStaker<string>> => {
    const [
      {
        bptBalanceOfStkPSPBpt,
        pspBalance,
        stkPSPBPtTotalSupply,
        bptTotalSupply,
      },
      stkPSPBalanceBN,
    ] = await Promise.all([
      this.fetchStkPSPBPtState(blockNumber),
      this.safetyModuleAsERC20.balanceOf(account, {
        blockTag: blockNumber,
      }) as Promise<EthersBN>,
    ]);

    const stkPSPBalance = stkPSPBalanceBN.toBigInt();

    const totalPSPStaked =
      (stkPSPBalance * bptBalanceOfStkPSPBpt * pspBalance) /
      (stkPSPBPtTotalSupply * bptTotalSupply);

    return {
      pspStaked: totalPSPStaked.toString(),
      breakdownByStakingContract: {
        ...(!!totalPSPStaked && {
          [SAFETY_MODULE_ADDRESS]: totalPSPStaked.toString(),
        }),
      },
    };
  };

  /// functions to fetch multiple stakers data efficiently
  async fetchStkPSPBptStakers(
    blockNumber?: number,
  ): Promise<DataByAccount<bigint>> {
    const stakes = await getTokenHolders({
      token: SAFETY_MODULE_ADDRESS,
      chainId: CHAIN_ID_MAINNET,
      ...(!!blockNumber && { blockHeight: String(blockNumber) }),
    });

    const stkPSPBptUsersBalances = Object.fromEntries(
      stakes.map(stake => [
        stake.address.toLowerCase(),
        BigInt(stake.balance.toString()),
      ]),
    );

    return stkPSPBptUsersBalances;
  }

  async fetchStkPSPBPtState(
    blockNumber?: number,
  ): Promise<StkPSPBPtState<bigint>> {
    const multicallData = [
      {
        target: SAFETY_MODULE_ADDRESS,
        callData: this.erc20Iface.encodeFunctionData('totalSupply', []),
      },
      {
        target: Balancer_80PSP_20WETH_address,
        callData: this.erc20Iface.encodeFunctionData('balanceOf', [
          SAFETY_MODULE_ADDRESS,
        ]),
      },
      {
        target: Balancer_80PSP_20WETH_address,
        callData: this.erc20Iface.encodeFunctionData('totalSupply', []),
      },
      {
        target: BalancerVaultAddress,
        callData: this.bVaultIface.encodeFunctionData('getPoolTokenInfo', [
          Balancer_80PSP_20WETH_poolId,
          PSP_ADDRESS[this.chainId],
        ]),
      },
    ];

    const rawResults: MulticallEncodedData =
      await this.multicallContract.functions.aggregate(multicallData, {
        blockTag: blockNumber,
      });

    const stkPSPBPtTotalSupply = BigInt(
      this.erc20Iface
        .decodeFunctionResult('totalSupply', rawResults.returnData[0])
        .toString(),
    );

    const bptBalanceOfStkPSPBpt = BigInt(
      this.erc20Iface
        .decodeFunctionResult('balanceOf', rawResults.returnData[1])
        .toString(),
    );

    const bptTotalSupply = BigInt(
      this.erc20Iface
        .decodeFunctionResult('totalSupply', rawResults.returnData[2])
        .toString(),
    );

    const pspBalance = BigInt(
      this.bVaultIface
        .decodeFunctionResult('getPoolTokenInfo', rawResults.returnData[3])[0]
        .toString(),
    );

    return {
      stkPSPBPtTotalSupply,
      bptBalanceOfStkPSPBpt,
      bptTotalSupply,
      pspBalance,
    };
  }

  async fetchPSPStakedInStkPSPBpt(
    blockNumber?: number,
  ): Promise<DataByAccount<bigint>> {
    const [
      stkPSPBalanceByAccount,
      {
        stkPSPBPtTotalSupply,
        bptBalanceOfStkPSPBpt,
        bptTotalSupply,
        pspBalance,
      },
    ] = await Promise.all([
      this.fetchStkPSPBptStakers(blockNumber),
      this.fetchStkPSPBPtState(blockNumber),
    ]);

    const stakesByAccount = Object.entries(stkPSPBalanceByAccount).reduce<
      DataByAccount<bigint>
    >((acc, [address, stkPSPBalance]) => {
      const pspStaked = this.computePSPStakedInStkPSPBpt({
        stkPSPBalance,
        bptBalanceOfStkPSPBpt,
        pspBalance,
        stkPSPBPtTotalSupply,
        bptTotalSupply,
      });

      acc[address] = pspStaked;

      return acc;
    }, {});

    return stakesByAccount;
  }

  computePSPStakedInStkPSPBpt({
    stkPSPBalance,
    bptBalanceOfStkPSPBpt,
    pspBalance,
    stkPSPBPtTotalSupply,
    bptTotalSupply,
  }: {
    stkPSPBalance: bigint;
    bptBalanceOfStkPSPBpt: bigint;
    pspBalance: bigint;
    stkPSPBPtTotalSupply: bigint;
    bptTotalSupply: bigint;
  }): bigint {
    const pspStaked =
      (stkPSPBalance * bptBalanceOfStkPSPBpt * pspBalance) /
      (stkPSPBPtTotalSupply * bptTotalSupply);

    return pspStaked;
  }
}
