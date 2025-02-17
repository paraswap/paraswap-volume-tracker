import * as ERC20ABI from '../../../../src/lib/abi/erc20.abi.json';
import * as BVaultABI from '../../../../src/lib/abi/balancer-vault.abi.json';
// import * as MultiCallerABI from '../../../../src/lib/abi/multicaller.abi.json';
import * as MulticallV3ABI from '../../../../src/lib/abi/multicall-v3.abi.json';
import {
  BalancerVaultAddress,
  MulticallEncodedData,
  MULTICALL_ADDRESS,
  XYZ_ADDRESS,
  Balancer_80XYZ_20WETH_address,
  Balancer_80XYZ_20WETH_poolId,
  MULTICALL_ADDRESS_V3,
} from '../../../../src/lib/constants';
import { Provider } from '../../../../src/lib/provider';
import { BigNumber as EthersBN, Contract } from 'ethers';
import { Interface } from '@ethersproject/abi';
import BigNumber from 'bignumber.js';

export type BPTState = {
  bptTotalSupply: BigNumber;
  xyzBalance: BigNumber;
  ethBalance: BigNumber;
};

export class BPTHelper_V3 {
  private static instance: { [chainId: number]: BPTHelper_V3 } = {};

  static getInstance(chainId: number) {
    if (!BPTHelper_V3.instance[chainId]) {
      BPTHelper_V3.instance[chainId] = new BPTHelper_V3(chainId);
    }
    return BPTHelper_V3.instance[chainId];
  }

  multicallContract: Contract;  
  bVaultIface: Interface;
  erc20Iface: Interface;

  constructor(protected chainId: number) {
    const provider = Provider.getJsonRpcProvider(this.chainId);

    


    this.multicallContract = new Contract(
      MULTICALL_ADDRESS_V3[this.chainId],
      MulticallV3ABI,
      // isMulticallV3 ? MulticallV3ABI : MultiCallerABI,
      provider,
    );

    this.bVaultIface = new Interface(BVaultABI);
    this.erc20Iface = new Interface(ERC20ABI);
  }

  async fetchBPtState(blockNumber?: number): Promise<BPTState> {
    const multicallData = [
      {
        target: Balancer_80XYZ_20WETH_address[this.chainId],
        callData: this.erc20Iface.encodeFunctionData('totalSupply', []),
        allowFailure: false
      },
      {
        target: BalancerVaultAddress,
        callData: this.bVaultIface.encodeFunctionData('getPoolTokens', [
          Balancer_80XYZ_20WETH_poolId[this.chainId],
        ]),
        allowFailure: false
      },
    ];

    
    const rawResults: MulticallEncodedData =
      await this.multicallContract.callStatic.aggregate3(multicallData, {
        blockTag: blockNumber,
      });       

    const bptTotalSupply = new BigNumber(
      this.erc20Iface
        .decodeFunctionResult('totalSupply', rawResults.returnData[0])
        .toString(),
    );

    const { tokens, balances } = this.bVaultIface.decodeFunctionResult(
      'getPoolTokens',
      rawResults.returnData[1],
    ) as unknown as {
      tokens: [string, string];
      balances: [EthersBN, EthersBN];
    };

    const isXYZToken0 =
      tokens[0].toLowerCase() === XYZ_ADDRESS[this.chainId].toLowerCase();
    const [xyzPoolBalance, etherPoolBalance] = isXYZToken0
      ? balances
      : [...balances].reverse();

    return {
      bptTotalSupply,
      xyzBalance: new BigNumber(xyzPoolBalance.toString()),
      ethBalance: new BigNumber(etherPoolBalance.toString()),
    };
  }
}
