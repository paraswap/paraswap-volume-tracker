import BigNumber from 'bignumber.js';
import { BigNumber as EthersBN, Contract, Event } from 'ethers';
import { assert } from 'ts-essentials';
import { CHAIN_ID_MAINNET, PSP_ADDRESS } from '../../../src/lib/constants';
import { Provider } from '../../../src/lib/provider';
import * as ERC20ABI from '../../../src/lib/abi/erc20.abi.json';
import * as BVaultABI from './balancer-vault-abi.json';
import { getTokenHolders } from './covalent';
import { fetchBlockTimestampForEvents, ZERO_BN } from '../utils';

const SafetyModuleAddress = '0xc8dc2ec5f5e02be8b37a8444a1931f02374a17ab';
const BalancerVaultAddress = '0xba12222222228d8ba445958a75a0704d566bf2c8';
const Balancer_80PSP_20WETH_poolId =
  '0xcb0e14e96f2cefa8550ad8e4aea344f211e5061d00020000000000000000011a';
const Balancer_80PSP_20WETH_address = Balancer_80PSP_20WETH_poolId.substring(
  0,
  42,
);

interface MinERC20 extends Contract {
  totalSupply(): Promise<EthersBN>;
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

// event Transfer(address indexed from, address indexed to, uint256 value);
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

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

type TimeSeriesItem = { timestamp: number; changes: BigNumber };
type TimeSeries = TimeSeriesItem[];

type InitState = {
  stkPSPBptStakes: { [address: string]: BigNumber };
  bptPoolPSPBalance: BigNumber;
  bptPoolTotalSupply: BigNumber;
};

type DiffState = {
  stkPSPBptStakes: { [address: string]: TimeSeries };
  bptPoolPSPBalance: TimeSeries;
  bptPoolTotalSupply: TimeSeries;
};

class SafetyModuleStakesTracker {
  startBlock: number;
  endBlock: number;
  initState: InitState = {
    stkPSPBptStakes: {},
    bptPoolPSPBalance: ZERO_BN,
    bptPoolTotalSupply: ZERO_BN,
  };
  differentialStates: DiffState = {
    stkPSPBptStakes: {},
    bptPoolPSPBalance: [],
    bptPoolTotalSupply: [],
  };

  async loadStakes(startBlock: number, endBlock: number) {
    this.startBlock = startBlock;
    this.endBlock = endBlock;

    await Promise.all([this.loadInitialState(), this.loadStateChanges()]);
  }

  async loadInitialState() {
    await Promise.all([
      this.fetchPSPBPtPoolState(),
      this.fetchBPTotalSupply(),
      this.fetchStkPSPBptStakers(),
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

  async fetchPSPBPtPoolState() {
    const [pspBalance] = await bVaultContract.getPoolTokenInfo(
      Balancer_80PSP_20WETH_poolId,
      PSP_ADDRESS[CHAIN_ID_MAINNET],
    );
    this.initState.bptPoolPSPBalance = new BigNumber(pspBalance.toString());
  }

  async fetchBPTotalSupply() {
    const totalSupply = await bptAsEERC20.totalSupply();
    this.initState.bptPoolTotalSupply = new BigNumber(totalSupply.toString());
  }

  async fetchStkPSPBptStakers() {
    const { items: stakes } = await getTokenHolders({
      token: SafetyModuleAddress,
      chainId: CHAIN_ID_MAINNET,
      blockHeight: String(this.startBlock - 1),
      pageSize: 10000,
    });

    this.initState.stkPSPBptStakes = stakes.reduce<{
      [address: string]: BigNumber;
    }>((acc, curr) => {
      acc[curr.address.toLowerCase()] = new BigNumber(curr.balance);
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
      const amount = new BigNumber(e.args[2].toString());

      if (from === ZERO_ADDRESS || to === ZERO_ADDRESS) {
        const isMint = from === ZERO_ADDRESS;

        assert(
          isMint || (!isMint && to === ZERO_ADDRESS),
          'invalid cond should either mint or burn here',
        );

        const _from = isMint ? to : from;

        if (!this.differentialStates.stkPSPBptStakes[_from])
          this.differentialStates.stkPSPBptStakes[_from] = [];

        this.differentialStates.stkPSPBptStakes[_from].push({
          timestamp,
          changes: amount.multipliedBy(isMint ? 1 : -1),
        });

        return;
      }

      if (!this.differentialStates.stkPSPBptStakes[from])
        this.differentialStates.stkPSPBptStakes[from] = [];

      this.differentialStates.stkPSPBptStakes[from].push({
        timestamp,
        changes: amount,
      });

      if (!this.differentialStates.stkPSPBptStakes[to])
        this.differentialStates.stkPSPBptStakes[to] = [];

      this.differentialStates.stkPSPBptStakes[to].push({
        timestamp,
        changes: amount.multipliedBy(-1),
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

    const bptPoolPSPBalanceChanges = events.map(e => {
      const timestamp = blockNumToTimestamp[e.blockNumber];
      assert(timestamp, 'block timestamp should be defined');

      assert(
        e.event === 'PoolBalanceChanged',
        'can only be poolBalanceChanged event',
      );
      const [, , tokens, amountsInOrOut] = e.args;

      assert(
        tokens[1].toLowerCase() === PSP_ADDRESS[CHAIN_ID_MAINNET].toLowerCase(),
        'logic error',
      );

      const pspAmountInOrOut = amountsInOrOut[1];

      return {
        timestamp,
        changes: new BigNumber(pspAmountInOrOut.toString()), // @FIXME: parse signed int256 for exit pool
      };
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
        tokenIn.toLowerCase() === PSP_ADDRESS[CHAIN_ID_MAINNET].toLowerCase() ||
        tokenOut.toLowerCase();
      const isPSPTokenOut =
        tokenOut.toLowerCase() === PSP_ADDRESS[CHAIN_ID_MAINNET].toLowerCase();
      assert(
        isPSPTokenIn || isPSPTokenOut,
        'logic error PSP should be in token in or out',
      );

      if (isPSPTokenIn)
        return {
          timestamp,
          changes: new BigNumber(amountIn.toString()),
        };

      return {
        timestamp,
        changes: new BigNumber(amountOut.toString()).multipliedBy(-1),
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
          bptAsEERC20.filters.Transfer(ZERO_ADDRESS),
          this.startBlock,
          this.endBlock,
        ),
        bptAsEERC20.queryFilter(
          bptAsEERC20.filters.Transfer(null, ZERO_ADDRESS),
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
        from === ZERO_ADDRESS || to === ZERO_ADDRESS,
        'can only be mint or burn',
      );

      const isMint = from === ZERO_ADDRESS;

      return {
        timestamp,
        changes: new BigNumber(amount.toString()).multipliedBy(isMint ? 1 : -1),
      };
    });

    this.differentialStates.bptPoolTotalSupply =
      this.differentialStates.bptPoolTotalSupply.concat(
        bptPoolTotalSupplyChanges,
      );
    this.differentialStates.bptPoolTotalSupply.sort(timeseriesComparator);
  }

  compute_BPT_to_PSP_Rate(timestamp: number) {
    const pspBalance = _reduceTimeSeries(
      timestamp,
      this.initState.bptPoolPSPBalance,
      this.differentialStates.bptPoolPSPBalance,
    );
    const totalSupply = _reduceTimeSeries(
      timestamp,
      this.initState.bptPoolTotalSupply,
      this.differentialStates.bptPoolTotalSupply,
    );
    return pspBalance.dividedBy(totalSupply);
  }

  // PSP-BPT / stkPSPbpt = 1 till no slashing
  compute_StkPSPBPT_to_PSP_Rate(timestamp: number) {
    return this.compute_BPT_to_PSP_Rate(timestamp);
  }

  computeStakedPSPBalance(_account: string, timestamp: number) {
    const account = _account.toLowerCase();
    const stkPSPBPT = _reduceTimeSeries(
      timestamp,
      this.initState.stkPSPBptStakes[account],
      this.differentialStates.stkPSPBptStakes[account],
    );
    const stkPSP2PSPRate = this.compute_StkPSPBPT_to_PSP_Rate(timestamp);

    return stkPSPBPT.multipliedBy(stkPSP2PSPRate);
  }
}

// microopt turn on memoisation / dynamic programing
function _reduceTimeSeries(
  timestamp: number,
  initValue: BigNumber | undefined,
  series: TimeSeries | undefined,
) {
  let sum = initValue || ZERO_BN;

  if (!series) return sum;

  // on first visiting sorting will cost, on subsequent visits sorting should be fast
  series.sort(timeseriesComparator);

  for (let i = 0; i < series.length; i++) {
    if (timestamp < series[i].timestamp) continue;
    if (timestamp > series[i].timestamp) break;

    sum = sum.plus(series[i].changes);
  }

  return sum;
}
function timeseriesComparator(a: TimeSeriesItem, b: TimeSeriesItem) {
  if (a.timestamp < b.timestamp) return -1;
  if (a.timestamp > b.timestamp) return 1;
  return 0;
}

export default new SafetyModuleStakesTracker();
