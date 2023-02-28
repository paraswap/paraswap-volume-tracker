import BigNumber from 'bignumber.js';
import { BigNumber as EthersBN, CallOverrides, Contract, Event } from 'ethers';
import { assert } from 'ts-essentials';
import {
  BalancerVaultAddress,
  Balancer_80PSP_20WETH_address,
  Balancer_80PSP_20WETH_poolId,
  CHAIN_ID_MAINNET,
  NULL_ADDRESS,
  PSP_ADDRESS,
  SAFETY_MODULE_ADDRESS,
} from '../../../src/lib/constants';
import { Provider } from '../../../src/lib/provider';
import * as ERC20ABI from '../../../src/lib/abi/erc20.abi.json';
import * as BVaultABI from '../../../src/lib/abi/balancer-vault.abi.json';
import {
  fetchBlockTimestampForEvents,
  ZERO_BN,
} from '../../../src/lib/utils/helpers';
import {
  reduceTimeSeries,
  TimeSeries,
  timeseriesComparator,
} from '../timeseries';
import { AbstractStakesTracker } from './abstract-stakes-tracker';
import { SafetyModuleHelper } from '../../../src/lib/staking/safety-module-helper';
import { VIRTUAL_LOCKUP_PERIOD } from '../../../src/lib/gas-refund/gas-refund';
import { computeMinStakedBalanceDuringVirtualLockup } from './common';

interface MinERC20 extends Contract {
  totalSupply(overrides?: CallOverrides): Promise<EthersBN>;
}

const StkPSPBPtAsERC20 = new Contract(
  SAFETY_MODULE_ADDRESS,
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

const bptAsERC20 = new Contract(
  Balancer_80PSP_20WETH_address[CHAIN_ID_MAINNET],
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
  bptPoolPSPBalance: BigNumber;
  bptPoolTotalSupply: BigNumber;
  stkPSPBPtTotalSupply: BigNumber;
  bptBalanceOfStkPSPBpt: BigNumber;
  stkPSPBptUsersBalances: { [address: string]: BigNumber };
};

type DiffState = {
  bptPoolPSPBalance: TimeSeries;
  bptPoolTotalSupply: TimeSeries;
  stkPSPBPtTotalSupply: TimeSeries;
  bptBalanceOfStkPSPBpt: TimeSeries;
  stkPSPBptUsersBalances: { [address: string]: TimeSeries };
};

export default class SafetyModuleStakesTracker extends AbstractStakesTracker {
  initState: InitState = {
    stkPSPBptUsersBalances: {},
    bptPoolPSPBalance: ZERO_BN,
    bptPoolTotalSupply: ZERO_BN,
    stkPSPBPtTotalSupply: ZERO_BN,
    bptBalanceOfStkPSPBpt: ZERO_BN,
  };
  differentialStates: DiffState = {
    stkPSPBptUsersBalances: {},
    bptPoolPSPBalance: [],
    bptPoolTotalSupply: [],
    stkPSPBPtTotalSupply: [],
    bptBalanceOfStkPSPBpt: [],
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
      SafetyModuleHelper.getInstance()
        .fetchStkPSPBptStakers(initBlock)
        .then(stakes => {
          this.initState.stkPSPBptUsersBalances = Object.fromEntries(
            Object.entries(stakes).map(([address, stake]) => [
              address,
              new BigNumber(stake.toString()),
            ]),
          );
        }),
      SafetyModuleHelper.getInstance()
        .fetchStkPSPBPtState(initBlock)
        .then(
          ({
            bptTotalSupply,
            pspBalance,
            stkPSPBPtTotalSupply,
            bptBalanceOfStkPSPBpt,
          }) => {
            this.initState.bptPoolTotalSupply = new BigNumber(
              bptTotalSupply.toString(),
            );
            this.initState.bptPoolPSPBalance = new BigNumber(
              pspBalance.toString(),
            );
            this.initState.stkPSPBPtTotalSupply = new BigNumber(
              stkPSPBPtTotalSupply.toString(),
            );
            this.initState.bptBalanceOfStkPSPBpt = new BigNumber(
              bptBalanceOfStkPSPBpt.toString(),
            );
          },
        ),
    ]);
  }

  async loadStateChanges() {
    return Promise.all([
      this.resolveStkPSPBptChanges(),
      this.resolveBPTPoolSupplyChanges(),
      this.resolveBPTBalanceOfStkPSPBptChanges(),
      this.resolveBPTPoolPSPBalanceChangesFromLP(),
      this.resolveBPTPoolPSPBalanceChangesFromSwaps(),
    ]);
  }

  async resolveStkPSPBptChanges() {
    const events = (await StkPSPBPtAsERC20.queryFilter(
      StkPSPBPtAsERC20.filters.Transfer(),
      this.startBlock,
      this.endBlock,
    )) as Transfer[];

    const blockNumToTimestamp = await fetchBlockTimestampForEvents(
      CHAIN_ID_MAINNET,
      events,
    );

    events.forEach(e => {
      const timestamp = blockNumToTimestamp[e.blockNumber];
      assert(timestamp, 'block timestamp should be defined');
      assert(e.event === 'Transfer', 'can only be transfer event');

      const from = e.args[0].toLowerCase();
      const to = e.args[1].toLowerCase();
      const amount = new BigNumber(e.args[2].toString());

      // Mint or Burn
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
          value: isMint ? amount : amount.negated(),
        });

        this.differentialStates.stkPSPBPtTotalSupply.push({
          timestamp,
          value: isMint ? amount : amount.negated(),
        });

        return;
      }

      // transfering stake between different accounts
      if (!this.differentialStates.stkPSPBptUsersBalances[from])
        this.differentialStates.stkPSPBptUsersBalances[from] = [];

      this.differentialStates.stkPSPBptUsersBalances[from].push({
        timestamp,
        value: amount.negated(),
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
      bVaultContract.filters.PoolBalanceChanged(
        Balancer_80PSP_20WETH_poolId[CHAIN_ID_MAINNET],
      ),
      this.startBlock,
      this.endBlock,
    )) as PoolBalanceChanged[];

    const blockNumToTimestamp = await fetchBlockTimestampForEvents(
      CHAIN_ID_MAINNET,
      events,
    );

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
          value: new BigNumber(pspAmountInOrOut.toString()), // onPoolJoin / onPoolExit amount is positive / negative
        },
        {
          timestamp,
          value: new BigNumber(
            paidProtocolSwapFeeAmounts[1].toString(),
          ).negated(),
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
      bVaultContract.filters.Swap(
        Balancer_80PSP_20WETH_poolId[CHAIN_ID_MAINNET],
      ),
      this.startBlock,
      this.endBlock,
    )) as Swap[];

    const blockNumToTimestamp = await fetchBlockTimestampForEvents(
      CHAIN_ID_MAINNET,
      events,
    );

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
          value: new BigNumber(amountIn.toString()),
        };

      return {
        timestamp,
        value: new BigNumber(amountOut.toString()).negated(),
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
        bptAsERC20.queryFilter(
          bptAsERC20.filters.Transfer(NULL_ADDRESS),
          this.startBlock,
          this.endBlock,
        ),
        bptAsERC20.queryFilter(
          bptAsERC20.filters.Transfer(null, NULL_ADDRESS),
          this.startBlock,
          this.endBlock,
        ),
      ])
    ).flat() as Transfer[];

    const blockNumToTimestamp = await fetchBlockTimestampForEvents(
      CHAIN_ID_MAINNET,
      events,
    );

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

      const value = new BigNumber(amount.toString());

      return {
        timestamp,
        value: isMint ? value : value.negated(),
      };
    });

    this.differentialStates.bptPoolTotalSupply =
      this.differentialStates.bptPoolTotalSupply.concat(
        bptPoolTotalSupplyChanges,
      );
    this.differentialStates.bptPoolTotalSupply.sort(timeseriesComparator);
  }

  async resolveBPTBalanceOfStkPSPBptChanges() {
    const events = (
      await Promise.all([
        bptAsERC20.queryFilter(
          bptAsERC20.filters.Transfer(null, SAFETY_MODULE_ADDRESS), // stake: user -> safety module
          this.startBlock,
          this.endBlock,
        ),
        bptAsERC20.queryFilter(
          bptAsERC20.filters.Transfer(SAFETY_MODULE_ADDRESS), // unstake: safety module -> user
          this.startBlock,
          this.endBlock,
        ),
      ])
    ).flat() as Transfer[];

    const blockNumToTimestamp = await fetchBlockTimestampForEvents(
      CHAIN_ID_MAINNET,
      events,
    );

    const bptBalanceOfStkPSPBptChanges = events.map(e => {
      const timestamp = blockNumToTimestamp[e.blockNumber];
      assert(timestamp, 'block timestamp should be defined');
      assert(e.event === 'Transfer', 'can only be Transfer event');

      const [from, to, amount] = e.args;

      assert(
        from.toLowerCase() === SAFETY_MODULE_ADDRESS ||
          to.toLowerCase() === SAFETY_MODULE_ADDRESS,
        'can only stake or unstake from safety module',
      );

      const isStake = to.toLowerCase() === SAFETY_MODULE_ADDRESS;
      const value = new BigNumber(amount.toString());

      return {
        timestamp,
        value: isStake ? value : value.negated(),
      };
    });

    this.differentialStates.bptBalanceOfStkPSPBpt =
      this.differentialStates.bptBalanceOfStkPSPBpt.concat(
        bptBalanceOfStkPSPBptChanges,
      );
    this.differentialStates.bptBalanceOfStkPSPBpt.sort(timeseriesComparator);
  }

  // @broken assumes all PSP in the balancer pool are detained by stkPSPBpt
  compute_BPT_to_PSP_Rate__broken(timestamp: number) {
    const bptPoolPSPBalance = reduceTimeSeries(
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
    return bptPoolPSPBalance.dividedBy(totalSupply);
  }

  computeStakedPSPBalanceBroken(account: string, timestamp: number) {
    this.assertTimestampWithinLoadInterval(timestamp);

    const stkPSPBPT = reduceTimeSeries(
      timestamp,
      this.initState.stkPSPBptUsersBalances[account],
      this.differentialStates.stkPSPBptUsersBalances[account],
    );
    const stkPSP2PSPRate = this.compute_BPT_to_PSP_Rate__broken(timestamp);

    return stkPSPBPT.multipliedBy(stkPSP2PSPRate);
  }

  computeStakedPSPBalanceWithVirtualLockupBroken(
    account: string,
    timestamp: number,
  ) {
    const startOfVirtualLockupPeriod = timestamp - VIRTUAL_LOCKUP_PERIOD;

    this.assertTimestampWithinLoadInterval(timestamp);
    this.assertTimestampWithinLoadInterval(startOfVirtualLockupPeriod);

    const stakeAtStartOfVirtualLockup = reduceTimeSeries(
      startOfVirtualLockupPeriod,
      this.initState.stkPSPBptUsersBalances[account],
      this.differentialStates.stkPSPBptUsersBalances[account],
    );

    const minStkPSPBptAmountHoldDuringVirtualLockup =
      computeMinStakedBalanceDuringVirtualLockup(
        timestamp,
        stakeAtStartOfVirtualLockup,
        this.differentialStates.stkPSPBptUsersBalances[account],
      );

    if (minStkPSPBptAmountHoldDuringVirtualLockup.isZero())
      return minStkPSPBptAmountHoldDuringVirtualLockup;

    const stkPSP2PSPRate = this.compute_BPT_to_PSP_Rate__broken(timestamp);

    return minStkPSPBptAmountHoldDuringVirtualLockup.multipliedBy(
      stkPSP2PSPRate,
    );
  }

  computeStakedPSPBalanceWithVirtualLockup(account: string, timestamp: number) {
    const startOfVirtualLockupPeriod = timestamp - VIRTUAL_LOCKUP_PERIOD;

    this.assertTimestampWithinLoadInterval(timestamp);
    this.assertTimestampWithinLoadInterval(startOfVirtualLockupPeriod);

    const stakeAtStartOfVirtualLockup = reduceTimeSeries(
      startOfVirtualLockupPeriod,
      this.initState.stkPSPBptUsersBalances[account],
      this.differentialStates.stkPSPBptUsersBalances[account],
    );

    const minStkPSPBptAmountHoldDuringVirtualLockup =
      computeMinStakedBalanceDuringVirtualLockup(
        timestamp,
        stakeAtStartOfVirtualLockup,
        this.differentialStates.stkPSPBptUsersBalances[account],
      );

    if (minStkPSPBptAmountHoldDuringVirtualLockup.isZero()) return ZERO_BN;

    const stkPSPBalance = minStkPSPBptAmountHoldDuringVirtualLockup;

    const bptPoolPSPBalance = reduceTimeSeries(
      timestamp,
      this.initState.bptPoolPSPBalance,
      this.differentialStates.bptPoolPSPBalance,
    );
    const bptTotalSupply = reduceTimeSeries(
      timestamp,
      this.initState.bptPoolTotalSupply,
      this.differentialStates.bptPoolTotalSupply,
    );

    const stkPSPBPtTotalSupply = reduceTimeSeries(
      timestamp,
      this.initState.stkPSPBPtTotalSupply,
      this.differentialStates.stkPSPBPtTotalSupply,
    );
    const bptBalanceOfStkPSPBpt = reduceTimeSeries(
      timestamp,
      this.initState.bptBalanceOfStkPSPBpt,
      this.differentialStates.bptBalanceOfStkPSPBpt,
    );

    // bignumber -> bigint, till whole code get refactoring with bigint
    const pspStaked =
      SafetyModuleHelper.getInstance().computePSPStakedInStkPSPBpt({
        stkPSPBalance: BigInt(stkPSPBalance.toFixed()),
        bptBalanceOfStkPSPBpt: BigInt(bptBalanceOfStkPSPBpt.toFixed()),
        pspBalance: BigInt(bptPoolPSPBalance.toFixed()),
        stkPSPBPtTotalSupply: BigInt(stkPSPBPtTotalSupply.toFixed()),
        bptTotalSupply: BigInt(bptTotalSupply.toFixed()),
      });

    return new BigNumber(pspStaked.toString());
  }
}
