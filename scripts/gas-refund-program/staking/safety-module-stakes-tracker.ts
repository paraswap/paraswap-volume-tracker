import { BigNumber as EthersBN, CallOverrides, Contract, Event } from 'ethers';
import { assert } from 'ts-essentials';
import {
  CHAIN_ID_MAINNET,
  NULL_ADDRESS,
  PSP_ADDRESS,
} from '../../../src/lib/constants';
import { Provider } from '../../../src/lib/provider';
import * as ERC20ABI from '../../../src/lib/abi/erc20.abi.json';
import * as BVaultABI from './balancer-vault-abi.json';
import { getTokenHolders } from './covalent';
import { fetchBlockTimestampForEvents } from '../utils';
import {
  reduceTimeSeries,
  TimeSeries,
  timeseriesComparator,
} from '../timeseries';
import AbstractStakeTracker from './abstract-stakes-tracker';

const SafetyModuleAddress = '0xc8dc2ec5f5e02be8b37a8444a1931f02374a17ab';
const BalancerVaultAddress = '0xba12222222228d8ba445958a75a0704d566bf2c8';
const Balancer_80PSP_20WETH_poolId =
  '0xcb0e14e96f2cefa8550ad8e4aea344f211e5061d00020000000000000000011a';
const Balancer_80PSP_20WETH_address = Balancer_80PSP_20WETH_poolId.substring(
  0,
  42,
); // or 0xcb0e14e96f2cefa8550ad8e4aea344f211e5061d

interface MinERC20 extends Contract {
  totalSupply(overrides?: CallOverrides): Promise<EthersBN>;
}

const StkPSPBPtAsERC20 = new Contract(
  SafetyModuleAddress,
  ERC20ABI,
  Provider.getJsonRpcProvider(CHAIN_ID_MAINNET),
) as MinERC20;

interface BVaultContract extends Contract {
  getPoolTokenInfo(
    poolId: string,
    token: string,
    overrides?: CallOverrides,
  ): Promise<
    [
      cash: EthersBN,
      managed: EthersBN,
      lastChangeBlock: EthersBN,
      assetManager: string,
    ]
  >;
}

const bVaultContract = new Contract(
  BalancerVaultAddress,
  BVaultABI,
  Provider.getJsonRpcProvider(CHAIN_ID_MAINNET),
) as BVaultContract;

const bptAsEERC20 = new Contract(
  Balancer_80PSP_20WETH_address,
  ERC20ABI,
  Provider.getJsonRpcProvider(CHAIN_ID_MAINNET),
) as MinERC20;

interface Transfer extends Event {
  event: 'Transfer';
  args: [from: string, to: string, value: EthersBN];
}

interface PoolBalanceChanged extends Event {
  event: 'PoolBalanceChanged';
  args: [
    poolId: string,
    sender: string,
    tokens: string[],
    amountsInOrOut: EthersBN[],
    paidProtocolSwapFeeAmounts: EthersBN[],
  ];
}

interface Swap extends Event {
  event: 'Swap';
  args: [
    poolId: string,
    tokenIn: string,
    tokenOut: string,
    amountInt: EthersBN,
    amountOut: EthersBN,
  ];
}

type InitState = {
  bptPoolPSPBalance: bigint;
  bptPoolTotalSupply: bigint;
  stkPSPBptUsersBalances: { [address: string]: bigint };
};

type DiffState = {
  bptPoolPSPBalance: TimeSeries;
  bptPoolTotalSupply: TimeSeries;
  stkPSPBptUsersBalances: { [address: string]: TimeSeries };
};

export default class SafetyModuleStakesTracker extends AbstractStakeTracker {
  initState: InitState = {
    stkPSPBptUsersBalances: {},
    bptPoolPSPBalance: BigInt(0),
    bptPoolTotalSupply: BigInt(0),
  };
  differentialStates: DiffState = {
    stkPSPBptUsersBalances: {},
    bptPoolPSPBalance: [],
    bptPoolTotalSupply: [],
  };

  static instance: SafetyModuleStakesTracker;

  static getInstance() {
    if (!this.instance) {
      this.instance = new SafetyModuleStakesTracker();
    }

    return this.instance;
  }

  async loadStakes() {
    await Promise.all([this.loadInitialState(), this.loadStateChanges()]);
  }

  async loadInitialState() {
    const initBlock = this.startBlock - 1;
    await Promise.all([
      this.fetchPSPBPtPoolState(initBlock),
      this.fetchBPTotalSupply(initBlock),
      this.fetchStkPSPBptStakers(initBlock),
    ]);
  }

  async loadStateChanges() {
    return Promise.all([
      this.resolveStkPSPBptChanges(),
      this.resolveBPTPoolSupplyChanges(),
      this.resolveBPTPoolPSPBalanceChangesFromLP(),
      this.resolveBPTPoolPSPBalanceChangesFromSwaps(),
    ]);
  }

  async fetchPSPBPtPoolState(initBlock: number) {
    const [pspBalance] = await bVaultContract.getPoolTokenInfo(
      Balancer_80PSP_20WETH_poolId,
      PSP_ADDRESS[CHAIN_ID_MAINNET],
      {
        blockTag: initBlock,
      },
    );
    this.initState.bptPoolPSPBalance = pspBalance.toBigInt();
  }

  async fetchBPTotalSupply(initBlock: number) {
    const totalSupply = await bptAsEERC20.totalSupply({ blockTag: initBlock });
    this.initState.bptPoolTotalSupply = totalSupply.toBigInt();
  }

  async fetchStkPSPBptStakers(initBlock: number) {
    const { items: stakes } = await getTokenHolders({
      token: SafetyModuleAddress,
      chainId: CHAIN_ID_MAINNET,
      blockHeight: String(initBlock),
      pageSize: 10000,
    });

    assert(
      stakes.length < 1000,
      'more than 1000 stakers not safe, fix pagination',
    );

    this.initState.stkPSPBptUsersBalances = stakes.reduce<{
      [address: string]: bigint;
    }>((acc, curr) => {
      acc[curr.address.toLowerCase()] = BigInt(curr.balance);
      return acc;
    }, {});
  }

  async resolveStkPSPBptChanges() {
    const events = (await StkPSPBPtAsERC20.queryFilter(
      StkPSPBPtAsERC20.filters.Transfer(),
      this.startBlock,
      this.endBlock,
    )) as Transfer[];

    const blockNumToTimestamp = await fetchBlockTimestampForEvents(events);

    events.forEach(e => {
      const timestamp = blockNumToTimestamp[e.blockNumber];
      assert(timestamp, 'block timestamp should be defined');
      assert(e.event === 'Transfer', 'can only be transfer event');

      const from = e.args[0].toLowerCase();
      const to = e.args[1].toLowerCase();
      const amount = e.args[2].toBigInt();

      if (from === NULL_ADDRESS || to === NULL_ADDRESS) {
        const isMint = from === NULL_ADDRESS;

        assert(
          isMint || (!isMint && to === NULL_ADDRESS),
          'invalid cond should either mint or burn here',
        );

        const _from = isMint ? to : from;

        if (!this.differentialStates.stkPSPBptUsersBalances[_from])
          this.differentialStates.stkPSPBptUsersBalances[_from] = [];

        this.differentialStates.stkPSPBptUsersBalances[_from].push({
          timestamp,
          value: isMint ? amount : -amount,
        });

        return;
      }

      if (!this.differentialStates.stkPSPBptUsersBalances[from])
        this.differentialStates.stkPSPBptUsersBalances[from] = [];

      this.differentialStates.stkPSPBptUsersBalances[from].push({
        timestamp,
        value: -amount,
      });

      if (!this.differentialStates.stkPSPBptUsersBalances[to])
        this.differentialStates.stkPSPBptUsersBalances[to] = [];

      this.differentialStates.stkPSPBptUsersBalances[to].push({
        timestamp,
        value: amount,
      });
    });
  }

  async resolveBPTPoolPSPBalanceChangesFromLP() {
    const events = (await bVaultContract.queryFilter(
      bVaultContract.filters.PoolBalanceChanged(Balancer_80PSP_20WETH_poolId),
      this.startBlock,
      this.endBlock,
    )) as PoolBalanceChanged[];

    const blockNumToTimestamp = await fetchBlockTimestampForEvents(events);

    const bptPoolPSPBalanceChanges = events.flatMap(e => {
      const timestamp = blockNumToTimestamp[e.blockNumber];
      assert(timestamp, 'block timestamp should be defined');

      assert(
        e.event === 'PoolBalanceChanged',
        'can only be poolBalanceChanged event',
      );
      const [, , tokens, amountsInOrOut, paidProtocolSwapFeeAmounts] = e.args;

      assert(
        tokens[1].toLowerCase() === PSP_ADDRESS[CHAIN_ID_MAINNET].toLowerCase(),
        'logic error',
      );

      const pspAmountInOrOut = amountsInOrOut[1];

      return [
        {
          timestamp,
          value: pspAmountInOrOut.toBigInt(), // onPoolJoin / onPoolExit amount is positive / negative
        },
        {
          timestamp,
          value: -paidProtocolSwapFeeAmounts[1].toBigInt(),
        },
      ];
    });

    this.differentialStates.bptPoolPSPBalance =
      this.differentialStates.bptPoolPSPBalance.concat(
        bptPoolPSPBalanceChanges,
      );
    this.differentialStates.bptPoolPSPBalance.sort(timeseriesComparator);
  }

  async resolveBPTPoolPSPBalanceChangesFromSwaps() {
    const events = (await bVaultContract.queryFilter(
      bVaultContract.filters.Swap(Balancer_80PSP_20WETH_poolId),
      this.startBlock,
      this.endBlock,
    )) as Swap[];

    const blockNumToTimestamp = await fetchBlockTimestampForEvents(events);

    const bptPoolPSPBalanceChanges = events.map(e => {
      const timestamp = blockNumToTimestamp[e.blockNumber];
      assert(timestamp, 'block timestamp should be defined');
      assert(e.event === 'Swap', 'can only be Swap Event event');

      const [, tokenIn, tokenOut, amountIn, amountOut] = e.args;

      const isPSPTokenIn =
        tokenIn.toLowerCase() === PSP_ADDRESS[CHAIN_ID_MAINNET].toLowerCase();
      const isPSPTokenOut =
        tokenOut.toLowerCase() === PSP_ADDRESS[CHAIN_ID_MAINNET].toLowerCase();

      assert(
        isPSPTokenIn || isPSPTokenOut,
        'logic error PSP should be in token in or out',
      );

      if (isPSPTokenIn)
        return {
          timestamp,
          value: amountIn.toBigInt(),
        };

      return {
        timestamp,
        value: -amountOut.toBigInt(),
      };
    });

    this.differentialStates.bptPoolPSPBalance =
      this.differentialStates.bptPoolPSPBalance.concat(
        bptPoolPSPBalanceChanges,
      );
    this.differentialStates.bptPoolPSPBalance.sort(timeseriesComparator);
  }

  async resolveBPTPoolSupplyChanges() {
    const events = (
      await Promise.all([
        bptAsEERC20.queryFilter(
          bptAsEERC20.filters.Transfer(NULL_ADDRESS),
          this.startBlock,
          this.endBlock,
        ),
        bptAsEERC20.queryFilter(
          bptAsEERC20.filters.Transfer(null, NULL_ADDRESS),
          this.startBlock,
          this.endBlock,
        ),
      ])
    ).flat() as Transfer[];

    const blockNumToTimestamp = await fetchBlockTimestampForEvents(events);

    const bptPoolTotalSupplyChanges = events.map(e => {
      const timestamp = blockNumToTimestamp[e.blockNumber];
      assert(timestamp, 'block timestamp should be defined');
      assert(e.event === 'Transfer', 'can only be Transfer event');

      const [from, to, amount] = e.args;

      assert(
        from === NULL_ADDRESS || to === NULL_ADDRESS,
        'can only be mint or burn',
      );

      const isMint = from === NULL_ADDRESS;

      const value = amount.toBigInt();

      return {
        timestamp,
        value: isMint ? value : -value,
      };
    });

    this.differentialStates.bptPoolTotalSupply =
      this.differentialStates.bptPoolTotalSupply.concat(
        bptPoolTotalSupplyChanges,
      );
    this.differentialStates.bptPoolTotalSupply.sort(timeseriesComparator);
  }

  compute_BPT_to_PSP_Rate(timestamp: number) {
    const pspBalance = reduceTimeSeries(
      timestamp,
      this.initState.bptPoolPSPBalance,
      this.differentialStates.bptPoolPSPBalance,
      false, // disable sorting as already done at compute time + collection could be huge
    );
    const totalSupply = reduceTimeSeries(
      timestamp,
      this.initState.bptPoolTotalSupply,
      this.differentialStates.bptPoolTotalSupply,
    );
    return pspBalance / totalSupply;
  }

  // PSP-BPT / stkPSPbpt = 1 till no slashing
  compute_StkPSPBPT_to_PSP_Rate(timestamp: number) {
    return this.compute_BPT_to_PSP_Rate(timestamp);
  }

  computeStakedPSPBalance(_account: string, timestamp: number) {
    const account = _account.toLowerCase();
    const stkPSPBPT = reduceTimeSeries(
      timestamp,
      this.initState.stkPSPBptUsersBalances[account],
      this.differentialStates.stkPSPBptUsersBalances[account],
    );
    const stkPSP2PSPRate = this.compute_StkPSPBPT_to_PSP_Rate(timestamp);

    return stkPSPBPT * stkPSP2PSPRate;
  }
}
