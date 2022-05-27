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
import { Contract } from 'ethers';
import { Interface } from '@ethersproject/abi';
import { getTokenHolders } from '../utils/covalent';
import { DataByAccount, StkPSPBPtState } from './types';

export class StkPSPBPTHelper {
  private static instance: StkPSPBPTHelper;

  static getInstance() {
    if (!StkPSPBPTHelper.instance) {
      StkPSPBPTHelper.instance = new StkPSPBPTHelper();
    }
    return StkPSPBPTHelper.instance;
  }

  chainId = CHAIN_ID_MAINNET; // all staking programs are only available on ethereum mainnet
  multicallContract: Contract;
  bVaultIface: Interface;
  erc20Iface: Interface;

  constructor() {
    const provider = Provider.getJsonRpcProvider(this.chainId);

    this.multicallContract = new Contract(
      MULTICALL_ADDRESS[this.chainId],
      MultiCallerABI,
      provider,
    );

    this.bVaultIface = new Interface(BVaultABI);
    this.erc20Iface = new Interface(ERC20ABI);
  }

  // this computes the staked PSP in the safety module for one account. This method is safe regarding to slashing.
  getPSPStakedInSafetyModule = async (account: string): Promise<bigint> => {
    const multicallData = [
      {
        target: SAFETY_MODULE_ADDRESS,
        callData: this.erc20Iface.encodeFunctionData('balanceOf', [account]),
      },
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
      await this.multicallContract.functions.aggregate(multicallData);

    const stkPSPBalance = BigInt(
      this.erc20Iface
        .decodeFunctionResult('balanceOf', rawResults.returnData[0])
        .toString(),
    );

    const stkPSPBPtTotalSupply = BigInt(
      this.erc20Iface
        .decodeFunctionResult('totalSupply', rawResults.returnData[1])
        .toString(),
    );

    const bptBalanceOfStkPSPBpt = BigInt(
      this.erc20Iface
        .decodeFunctionResult('balanceOf', rawResults.returnData[2])
        .toString(),
    );

    const bptTotalSupply = BigInt(
      this.erc20Iface
        .decodeFunctionResult('totalSupply', rawResults.returnData[3])
        .toString(),
    );

    const pspBalance = BigInt(
      this.bVaultIface
        .decodeFunctionResult('getPoolTokenInfo', rawResults.returnData[4])[0]
        .toString(),
    );

    return (
      (stkPSPBalance * bptBalanceOfStkPSPBpt * pspBalance) /
      (stkPSPBPtTotalSupply * bptTotalSupply)
    );
  };

  /// functions to fetch multiple stakers data efficiently
  async fetchStkPSPBptStakers(
    initBlock?: number,
  ): Promise<DataByAccount<bigint>> {
    const stakes = await getTokenHolders({
      token: SAFETY_MODULE_ADDRESS,
      chainId: CHAIN_ID_MAINNET,
      ...(!!initBlock && { blockHeight: String(initBlock) }),
    });

    const stkPSPBptUsersBalances = stakes.reduce<{
      [address: string]: bigint;
    }>((acc, curr) => {
      acc[curr.address.toLowerCase()] = BigInt(curr.balance);
      return acc;
    }, {});

    return stkPSPBptUsersBalances;
  }

  async fetchStkPSPBPtState(
    initBlock?: number,
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
        blockTag: initBlock,
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
      const pspStaked =
        (stkPSPBalance * bptBalanceOfStkPSPBpt * pspBalance) /
        (stkPSPBPtTotalSupply * bptTotalSupply);

      acc[address] = pspStaked;

      return acc;
    }, {});

    return stakesByAccount;
  }
}
