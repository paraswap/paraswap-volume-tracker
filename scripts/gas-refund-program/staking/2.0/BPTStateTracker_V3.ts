import { BigNumber as EthersBN, CallOverrides, Contract, Event } from 'ethers';
import { assert } from 'ts-essentials';
import {
  BalancerVaultAddress,
  Balancer_80XYZ_20WETH_address,
  Balancer_80XYZ_20WETH_poolId,
  NULL_ADDRESS,
  XYZ_ADDRESS,
} from '../../../../src/lib/constants';
import { Provider } from '../../../../src/lib/provider';
import * as ERC20ABI from '../../../../src/lib/abi/erc20.abi.json';
import * as BVaultABI from '../../../../src/lib/abi/balancer-vault.abi.json';
import {
  fetchBlockTimestampForEvents,
  ZERO_BN,
} from '../../../../src/lib/utils/helpers';
import {
  reduceTimeSeries,
  TimeSeries,
  timeseriesComparator,
} from '../../timeseries';
import { BPTHelper } from './BPTHelper';
import {
  AbstractStateTracker,
  BlockTimeBoundary,
} from './AbstractStateTracker';
import BigNumber from 'bignumber.js';
import { imReverse } from '../../../../src/lib/utils';
import { QUERY_EVENT_BATCH_SIZE_BY_CHAIN, queryFilterBatched } from './utils';
import { grp2CConfigParticularities } from '../../../../src/lib/gas-refund/config';
import { BPTHelper_V3 } from './BPTHelper_V3';

interface MinERC20 extends Contract {
  totalSupply(overrides?: CallOverrides): Promise<EthersBN>;
}

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
  xyzBalance: BigNumber;
  ethBalance: BigNumber;
  totalSupply: BigNumber;
};

type DiffState = {
  xyzBalance: TimeSeries;
  ethBalance: TimeSeries;
  totalSupply: TimeSeries;
};

export default class BPTStateTracker_V3 extends AbstractStateTracker {
  initState: InitState = {
    xyzBalance: ZERO_BN,
    ethBalance: ZERO_BN,
    totalSupply: ZERO_BN,
  };
  differentialStates: DiffState = {
    xyzBalance: [],
    ethBalance: [],
    totalSupply: [],
  };

  static instance: { [chainId: number]: BPTStateTracker_V3 } = {};

  bVaultContract: Contract;
  bptAsERC20: Contract;

  constructor(protected chainId: number) {
    super(chainId);

    this.bVaultContract = new Contract(
      BalancerVaultAddress, // same address for all chains
      BVaultABI,
      Provider.getJsonRpcProvider(this.chainId),
    ) as BVaultContract;

    const poolId = Balancer_80XYZ_20WETH_address[this.chainId];

    this.bptAsERC20 = new Contract(
      poolId,
      ERC20ABI,
      Provider.getJsonRpcProvider(this.chainId),
    ) as MinERC20;
  }

  static getInstance(chainId: number) {
    if (!this.instance[chainId]) {
      this.instance[chainId] = new BPTStateTracker_V3(chainId);
    }

    return this.instance[chainId];
  }

  async loadStates() {
    // await Promise.all([this.loadInitialState(), this.loadStateChanges()]);
    try {
      await this.loadInitialState();
    } catch (e) {
      debugger;
      throw e;
    }

    try {
      await this.loadStateChanges();
    } catch (e) {
      debugger;
      throw e;
    }
  }

  async loadInitialState() {
    const initBlock = this.startBlock - 1;

    const { bptTotalSupply, xyzBalance, ethBalance } =
      await BPTHelper_V3.getInstance(this.chainId).fetchBPtState(initBlock);
    this.initState.totalSupply = bptTotalSupply;
    this.initState.xyzBalance = xyzBalance;
    this.initState.ethBalance = ethBalance;
  }

  async loadStateChanges() {
    return Promise.all([
      this.resolveBPTPoolSupplyChanges(),
      this.resolveBPTPoolXYZBalanceChangesFromLP(),
      this.resolveBPTPoolXYZBalanceChangesFromSwaps(),
    ]);
  }

  // adjust to populate eth balance too
  async resolveBPTPoolXYZBalanceChangesFromLP() {
    let events = (await queryFilterBatched(
      this.bVaultContract,
      this.bVaultContract.filters.PoolBalanceChanged(
        Balancer_80XYZ_20WETH_poolId[this.chainId],
      ),
      this.startBlock,
      this.endBlock,
      { batchSize: QUERY_EVENT_BATCH_SIZE_BY_CHAIN[this.chainId] },
    )) as PoolBalanceChanged[];

    const blockNumToTimestamp = await fetchBlockTimestampForEvents(
      this.chainId,
      events,
    );

    events.forEach(e => {
      const timestamp = blockNumToTimestamp[e.blockNumber];
      assert(timestamp, 'block timestamp should be defined');

      assert(
        e.event === 'PoolBalanceChanged',
        'can only be poolBalanceChanged event',
      );
      const [, , _tokens, amountsInOrOut, paidProtocolSwapFeeAmounts] = e.args;
      const tokens = _tokens.map(t => t.toLowerCase());

      const isXYZToken0 = tokens[0] === XYZ_ADDRESS[this.chainId].toLowerCase();

      assert(
        tokens.includes(XYZ_ADDRESS[this.chainId].toLowerCase()),
        'xyz should be either token0 or token 1',
      );

      const [[xyzAmount, ethAmount], [xyzFees, ethFees]] = isXYZToken0
        ? [amountsInOrOut, paidProtocolSwapFeeAmounts]
        : [imReverse(amountsInOrOut), imReverse(paidProtocolSwapFeeAmounts)];

      this.differentialStates.xyzBalance.push({
        timestamp,
        value: new BigNumber(xyzAmount.toString()).minus(xyzFees.toString()),
      });

      this.differentialStates.ethBalance.push({
        timestamp,
        value: new BigNumber(ethAmount.toString()).minus(ethFees.toString()),
      });
    });

    this.differentialStates.xyzBalance.sort(timeseriesComparator);
    this.differentialStates.ethBalance.sort(timeseriesComparator);
  }

  async resolveBPTPoolXYZBalanceChangesFromSwaps() {
    const events = (await queryFilterBatched(
      this.bVaultContract,
      this.bVaultContract.filters.Swap(
        Balancer_80XYZ_20WETH_poolId[this.chainId],
      ),
      this.startBlock,
      this.endBlock,
      { batchSize: QUERY_EVENT_BATCH_SIZE_BY_CHAIN[this.chainId] },
    )) as Swap[];

    const blockNumToTimestamp = await fetchBlockTimestampForEvents(
      this.chainId,
      events,
    );

    events.forEach(e => {
      const timestamp = blockNumToTimestamp[e.blockNumber];
      assert(timestamp, 'block timestamp should be defined');
      assert(e.event === 'Swap', 'can only be Swap Event event');

      const [, tokenIn, tokenOut, amountIn, amountOut] = e.args;

      const isXYZTokenIn =
        tokenIn.toLowerCase() === XYZ_ADDRESS[this.chainId].toLowerCase();
      const isXYZTokenOut =
        tokenOut.toLowerCase() === XYZ_ADDRESS[this.chainId].toLowerCase();

      assert(
        isXYZTokenIn || isXYZTokenOut,
        'logic error XYZ should be in token in or out',
      );

      const isEthTokenIn = isXYZTokenOut;

      this.differentialStates.xyzBalance.push({
        timestamp,
        value: isXYZTokenIn
          ? new BigNumber(amountIn.toString())
          : new BigNumber(amountOut.toString()).negated(),
      });

      this.differentialStates.ethBalance.push({
        timestamp,
        value: isEthTokenIn
          ? new BigNumber(amountIn.toString())
          : new BigNumber(amountOut.toString()).negated(),
      });
    });

    this.differentialStates.xyzBalance.sort(timeseriesComparator);
    this.differentialStates.ethBalance.sort(timeseriesComparator);
  }

  async resolveBPTPoolSupplyChanges() {
    const events = (
      await Promise.all([
        queryFilterBatched(
          this.bptAsERC20,
          this.bptAsERC20.filters.Transfer(NULL_ADDRESS),
          this.startBlock,
          this.endBlock,
          { batchSize: QUERY_EVENT_BATCH_SIZE_BY_CHAIN[this.chainId] },
        ),
        queryFilterBatched(
          this.bptAsERC20,
          this.bptAsERC20.filters.Transfer(null, NULL_ADDRESS),
          this.startBlock,
          this.endBlock,
          { batchSize: QUERY_EVENT_BATCH_SIZE_BY_CHAIN[this.chainId] },
        ),
      ])
    ).flat() as Transfer[];

    const blockNumToTimestamp = await fetchBlockTimestampForEvents(
      this.chainId,
      events,
    );

    const totalSupplyChanges = events.map(e => {
      const timestamp = blockNumToTimestamp[e.blockNumber];
      assert(timestamp, 'block timestamp should be defined');
      assert(e.event === 'Transfer', 'can only be Transfer event');

      const [from, to, amount] = e.args;

      assert(
        from === NULL_ADDRESS || to === NULL_ADDRESS,
        'can only be mint or burn',
      );

      const isMint = from === NULL_ADDRESS;

      const value = new BigNumber(amount.toString());

      return {
        timestamp,
        value: isMint ? value : value.negated(),
      };
    });

    this.differentialStates.totalSupply =
      this.differentialStates.totalSupply.concat(totalSupplyChanges);
    this.differentialStates.totalSupply.sort(timeseriesComparator);
  }

  getBPTState(timestamp: number) {
    this.assertTimestampWithinLoadInterval(timestamp);
    const totalSupply = reduceTimeSeries(
      timestamp,
      this.initState.totalSupply,
      this.differentialStates.totalSupply,
    );
    const xyzBalance = reduceTimeSeries(
      timestamp,
      this.initState.xyzBalance,
      this.differentialStates.xyzBalance,
    );
    const ethBalance = reduceTimeSeries(
      timestamp,
      this.initState.ethBalance,
      this.differentialStates.ethBalance,
    );

    return { totalSupply, xyzBalance, ethBalance };
  }
}
