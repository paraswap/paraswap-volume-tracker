import { BigNumber as EthersBN, CallOverrides, Contract, Event } from 'ethers';
import { assert } from 'ts-essentials';
import {
  BalancerVaultAddress,
  Balancer_80PSP_20WETH_address,
  Balancer_80PSP_20WETH_poolId,
  NULL_ADDRESS,
  PSP_ADDRESS,
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
import { queryFilterBatched } from './utils';
import { grp2CConfigParticularities } from '../../../../src/lib/gas-refund/config';

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
  pspBalance: BigNumber;
  ethBalance: BigNumber;
  totalSupply: BigNumber;
};

type DiffState = {
  pspBalance: TimeSeries;
  ethBalance: TimeSeries;
  totalSupply: TimeSeries;
};

export default class BPTStateTracker extends AbstractStateTracker {
  initState: InitState = {
    pspBalance: ZERO_BN,
    ethBalance: ZERO_BN,
    totalSupply: ZERO_BN,
  };
  differentialStates: DiffState = {
    pspBalance: [],
    ethBalance: [],
    totalSupply: [],
  };

  static instance: { [chainId: number]: BPTStateTracker } = {};

  bVaultContract: Contract;
  bptAsERC20: Contract;

  constructor(protected chainId: number) {
    super(chainId);

    this.bVaultContract = new Contract(
      BalancerVaultAddress, // same address for all chains
      BVaultABI,
      Provider.getJsonRpcProvider(this.chainId),
    ) as BVaultContract;

    const poolId = Balancer_80PSP_20WETH_address[this.chainId];

    this.bptAsERC20 = new Contract(
      poolId,
      ERC20ABI,
      Provider.getJsonRpcProvider(this.chainId),
    ) as MinERC20;
  }

  static getInstance(chainId: number) {
    if (!this.instance[chainId]) {
      this.instance[chainId] = new BPTStateTracker(chainId);
    }

    return this.instance[chainId];
  }

  async loadStates() {
    await Promise.all([this.loadInitialState(), this.loadStateChanges()]);
  }

  async loadInitialState() {
    const initBlock = this.startBlock - 1;

    const { bptTotalSupply, pspBalance, ethBalance } =
      await BPTHelper.getInstance(this.chainId).fetchBPtState(initBlock);
    this.initState.totalSupply = bptTotalSupply;
    this.initState.pspBalance = pspBalance;
    this.initState.ethBalance = ethBalance;
  }

  async loadStateChanges() {
    return Promise.all([
      this.resolveBPTPoolSupplyChanges(),
      this.resolveBPTPoolPSPBalanceChangesFromLP(),
      this.resolveBPTPoolPSPBalanceChangesFromSwaps(),
    ]);
  }

  // adjust to populate eth balance too
  async resolveBPTPoolPSPBalanceChangesFromLP() {
    let events = (await queryFilterBatched(
      this.bVaultContract,
      this.bVaultContract.filters.PoolBalanceChanged(
        Balancer_80PSP_20WETH_poolId[this.chainId],
      ),
      this.startBlock,
      this.endBlock,
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

      const isPSPToken0 = tokens[0] === PSP_ADDRESS[this.chainId].toLowerCase();

      assert(
        tokens.includes(PSP_ADDRESS[this.chainId].toLowerCase()),
        'psp should be either token0 or token 1',
      );

      const [[pspAmount, ethAmount], [pspFees, ethFees]] = isPSPToken0
        ? [amountsInOrOut, paidProtocolSwapFeeAmounts]
        : [imReverse(amountsInOrOut), imReverse(paidProtocolSwapFeeAmounts)];

      this.differentialStates.pspBalance.push({
        timestamp,
        value: new BigNumber(pspAmount.toString()).minus(pspFees.toString()),
      });

      this.differentialStates.ethBalance.push({
        timestamp,
        value: new BigNumber(ethAmount.toString()).minus(ethFees.toString()),
      });
    });

    this.differentialStates.pspBalance.sort(timeseriesComparator);
    this.differentialStates.ethBalance.sort(timeseriesComparator);
  }

  async resolveBPTPoolPSPBalanceChangesFromSwaps() {
    const events = (await queryFilterBatched(
      this.bVaultContract,
      this.bVaultContract.filters.Swap(
        Balancer_80PSP_20WETH_poolId[this.chainId],
      ),
      this.startBlock,
      this.endBlock,
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

      const isPSPTokenIn =
        tokenIn.toLowerCase() === PSP_ADDRESS[this.chainId].toLowerCase();
      const isPSPTokenOut =
        tokenOut.toLowerCase() === PSP_ADDRESS[this.chainId].toLowerCase();

      assert(
        isPSPTokenIn || isPSPTokenOut,
        'logic error PSP should be in token in or out',
      );

      const isEthTokenIn = isPSPTokenOut;

      this.differentialStates.pspBalance.push({
        timestamp,
        value: isPSPTokenIn
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

    this.differentialStates.pspBalance.sort(timeseriesComparator);
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
        ),
        queryFilterBatched(
          this.bptAsERC20,
          this.bptAsERC20.filters.Transfer(null, NULL_ADDRESS),
          this.startBlock,
          this.endBlock,
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
    const pspBalance = reduceTimeSeries(
      timestamp,
      this.initState.pspBalance,
      this.differentialStates.pspBalance,
    );
    const ethBalance = reduceTimeSeries(
      timestamp,
      this.initState.ethBalance,
      this.differentialStates.ethBalance,
    );

    return { totalSupply, pspBalance, ethBalance };
  }
}
