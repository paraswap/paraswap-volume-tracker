import * as ERC20ABI from './abi/erc20.abi.json';
import * as BVaultABI from './abi/balancer-vault.abi.json';
import * as SPSPABI from './abi/spsp.abi.json';
import * as MultiCallerABI from './abi/multicaller.abi.json';
import { Contract } from 'ethers';
import { PoolConfigsMap } from './pool-info';
import {
  BalancerVaultAddress,
  Balancer_80PSP_20WETH_address,
  CHAIN_ID_MAINNET,
  MULTICALL_ADDRESS,
  SAFETY_MODULE_ADDRESS,
  PSP_ADDRESS,
  MulticallEncodedData,
  Balancer_80PSP_20WETH_poolId,
} from './constants';
import { Provider } from './provider';
import { Interface } from '@ethersproject/abi';

export type Stakes<T> = {
  totalPSPStaked: T;
  descr: {
    totalPSPStakedInSPSP: T;
    totalPSPStakedInSafetyModule: T;
  };
};

export const SPSPAddresses = PoolConfigsMap[CHAIN_ID_MAINNET].filter(
  p => p.isActive,
).map(p => p.address.toLowerCase());

export class StakingService {
  static instance: StakingService;

  static getInstance() {
    if (!this.instance) {
      this.instance = new StakingService();
    }

    return this.instance;
  }

  chainId = CHAIN_ID_MAINNET; // all staking programs are only available on ethereum mainnet
  multicallContract: Contract;
  sPSPIFace: Interface;
  bVaultIface: Interface;
  erc20Iface: Interface;

  constructor() {
    const provider = Provider.getJsonRpcProvider(this.chainId);

    this.multicallContract = new Contract(
      MULTICALL_ADDRESS[this.chainId],
      MultiCallerABI,
      provider,
    );

    this.sPSPIFace = new Interface(SPSPABI);
    this.bVaultIface = new Interface(BVaultABI);
    this.erc20Iface = new Interface(ERC20ABI);
  }

  // PSPBalanceOf on all pools then reduce
  getPSPStakedInSPSPs = async (account: string): Promise<bigint> => {
    const multicallData = SPSPAddresses.map(address => ({
      target: address,
      callData: this.sPSPIFace.encodeFunctionData('PSPBalance', [account]),
    }));

    const rawResult: MulticallEncodedData =
      await this.multicallContract.functions.aggregate(multicallData);

    const allStakes = rawResult.returnData.map(r =>
      BigInt(this.sPSPIFace.decodeFunctionResult('PSPBalance', r).toString()),
    );

    const totalStakes = allStakes.reduce((acc, curr) => acc + curr, BigInt(0));

    return totalStakes;
  };

  // this computes the staked PSP in the safety module. This method is safe regarding to slashing
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

  getPSPStakesAllPrograms = async (
    account: string,
  ): Promise<Stakes<string>> => {
    const [totalPSPStakedInSPSP, totalPSPStakedInSafetyModule] =
      await Promise.all([
        this.getPSPStakedInSPSPs(account),
        this.getPSPStakedInSafetyModule(account),
      ]);

    return {
      totalPSPStaked: (
        totalPSPStakedInSPSP + totalPSPStakedInSafetyModule
      ).toString(),

      descr: {
        totalPSPStakedInSPSP: totalPSPStakedInSPSP.toString(),
        totalPSPStakedInSafetyModule: totalPSPStakedInSafetyModule.toString(),
      },
    };
  };
}
