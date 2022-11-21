import * as ERC20ABI from '../../../../src/lib/abi/erc20.abi.json';
import * as BVaultABI from '../../../../src/lib/abi/balancer-vault.abi.json';
import * as MultiCallerABI from '../../../../src/lib/abi/multicaller.abi.json';
import {
  BalancerVaultAddress,
  Balancer_80PSP_20WETH_address,
  Balancer_80PSP_20WETH_poolId,
  MulticallEncodedData,
  MULTICALL_ADDRESS,
  PSP_ADDRESS,
} from '../../../../src/lib/constants';
import { Provider } from '../../../../src/lib/provider';
import { BigNumber as EthersBN, Contract } from 'ethers';
import { Interface } from '@ethersproject/abi';
import BigNumber from 'bignumber.js';

export type BPTState = {
  bptTotalSupply: BigNumber;
  pspBalance: BigNumber;
  ethBalance: BigNumber;
};

export class BPTHelper {
  private static instance: BPTHelper;

  static getInstance(chainId: number) {
    if (!BPTHelper.instance) {
      BPTHelper.instance = new BPTHelper(chainId);
    }
    return BPTHelper.instance;
  }

  multicallContract: Contract;
  safetyModuleAsERC20: Contract;
  bVaultIface: Interface;
  erc20Iface: Interface;

  constructor(protected chainId: number) {
    const provider = Provider.getJsonRpcProvider(this.chainId);

    this.multicallContract = new Contract(
      MULTICALL_ADDRESS[this.chainId],
      MultiCallerABI,
      provider,
    );

    this.bVaultIface = new Interface(BVaultABI);
    this.erc20Iface = new Interface(ERC20ABI);
  }

  async fetchBPtState(blockNumber?: number): Promise<BPTState> {
    const multicallData = [
      {
        target: Balancer_80PSP_20WETH_address, // FIXME segment by chainId
        callData: this.erc20Iface.encodeFunctionData('totalSupply', []),
      },
      {
        target: BalancerVaultAddress,
        callData: this.bVaultIface.encodeFunctionData('getPoolTokens', [
          Balancer_80PSP_20WETH_poolId, // FIXME segment by chainId
        ]),
      },
    ];

    const rawResults: MulticallEncodedData =
      await this.multicallContract.functions.aggregate(multicallData, {
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

    const isPSPToken0 =
      tokens[0].toLowerCase() === PSP_ADDRESS[this.chainId].toLowerCase();
    const [pspPoolBalance, etherPoolBalance] = isPSPToken0
      ? balances
      : [...balances].reverse();

    return {
      bptTotalSupply,
      pspBalance: new BigNumber(pspPoolBalance.toString()),
      ethBalance: new BigNumber(etherPoolBalance.toString()),
    };
  }
}
