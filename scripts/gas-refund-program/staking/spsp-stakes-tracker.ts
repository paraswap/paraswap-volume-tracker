import BigNumber from 'bignumber.js';
import {
  BigNumber as EthersBN,
  CallOverrides,
  Contract,
  Event,
  EventFilter,
} from 'ethers';
import {
  CHAIN_ID_MAINNET,
  NULL_ADDRESS,
  PSP_ADDRESS,
} from '../../../src/lib/constants';
import { Provider } from '../../../src/lib/provider';
import * as ERC20ABI from '../../../src/lib/abi/erc20.abi.json';
import * as SPSPABI from '../../../src/lib/abi/spsp.abi.json';
import { getTokenHolders } from './covalent';
import { fetchBlockTimestampForEvents, ZERO_BN } from '../utils';
import { reduceTimeSeries, TimeSeries } from '../timeseries';
import { PoolConfigsMap } from '../../../src/lib/pool-info';
import AbstractStakeTracker from './abstract-stakes-tracker';
import { assert } from 'ts-essentials';

const SPSPAddresses = PoolConfigsMap[CHAIN_ID_MAINNET].filter(
  p => p.isActive,
).map(p => p.address.toLowerCase());
const SPSPAddressesSet = new Set(SPSPAddresses);

interface MinSPSP extends Contract {
  totalSupply(overrides?: CallOverrides): Promise<EthersBN>;
  pspsLocked(overrides?: CallOverrides): Promise<EthersBN>;
}

const SPSPPrototypeContract = new Contract(
  NULL_ADDRESS,
  SPSPABI,
  Provider.getJsonRpcProvider(CHAIN_ID_MAINNET),
) as MinSPSP;

const PSPContract = new Contract(
  PSP_ADDRESS[CHAIN_ID_MAINNET],
  ERC20ABI,
  Provider.getJsonRpcProvider(CHAIN_ID_MAINNET),
);

interface Transfer extends Event {
  event: 'Transfer';
  args: [from: string, to: string, value: EthersBN];
}
interface Unstaked extends Event {
  event: 'Unstaked';
  args: [id: EthersBN, user: string, amount: EthersBN];
}
interface Withdraw extends Event {
  event: 'Withdraw';
  args: [id: EthersBN, user: string, amount: EthersBN];
}
interface Entered extends Event {
  event: 'Entered';
  args: [user: string, amount: EthersBN];
}
interface Reentered extends Event {
  event: 'Reentered';
  args: [id: EthersBN, user: string, amount: EthersBN];
}

type InitState = {
  totalSupply: { [poolAddress: string]: BigNumber };
  pspBalance: { [poolAddress: string]: BigNumber };
  pspsLocked: { [poolAddress: string]: BigNumber };
  sPSPBalanceByAccount: {
    [poolAddress: string]: { [accountAddress: string]: BigNumber };
  };
};

type DiffState = {
  totalSupply: { [poolAddress: string]: TimeSeries };
  pspBalance: { [poolAddress: string]: TimeSeries };
  pspsLocked: { [poolAddress: string]: TimeSeries };
  sPSPBalanceByAccount: {
    [poolAddress: string]: { [accountAddress: string]: TimeSeries };
  };
};

export default class SPSPStakesTracker extends AbstractStakeTracker {
  initState: InitState = {
    totalSupply: {},
    pspBalance: {},
    pspsLocked: {},
    sPSPBalanceByAccount: {},
  };
  differentialStates: DiffState = {
    totalSupply: {},
    pspBalance: {},
    pspsLocked: {},
    sPSPBalanceByAccount: {},
  };

  static instance: SPSPStakesTracker;

  static getInstance() {
    if (!this.instance) {
      this.instance = new SPSPStakesTracker();
    }

    return this.instance;
  }

  async loadStakes() {
    await Promise.all([this.loadInitialState(), this.loadStateChanges()]);
  }

  async loadInitialState() {
    const initBlock = this.startBlock - 1;
    await Promise.all([
      this.fetchSPSPsState(initBlock),
      this.fetchSPSPsStakers(initBlock),
    ]);
  }

  async loadStateChanges() {
    return Promise.all([
      this.resolveInternalPoolChanges(),
      this.resolvePSPBalanceChanges(),
    ]);
  }

  async fetchSPSPsState(initBlock: number) {
    // @TODO multicall to get totalSupply, sPSPLocked, PSP Balance
  }

  async fetchSPSPsStakers(initBlock: number) {
    // @TODO call to covalent to fetch all stakers
  }

  async resolveInternalPoolChanges() {
    const allEventsAllPools = (
      await Promise.all(
        SPSPAddresses.map(async poolAddress => {
          const SPSPContract = SPSPPrototypeContract.attach(poolAddress);
          return SPSPContract.queryFilter(
            '*' as EventFilter,
            this.startBlock,
            this.endBlock,
          );
        }),
      )
    ).flat();

    const blockNumToTimestamp = await fetchBlockTimestampForEvents(
      allEventsAllPools,
    );

    allEventsAllPools.forEach(e => {
      const poolAddress = e.address;

      if (!SPSPAddressesSet.has(poolAddress)) {
        return;
      }

      const { event } = e;
      const timestamp = blockNumToTimestamp[e.blockNumber];

      switch (event) {
        case 'Transfer':
          this.handleSPSPBalance(e as Transfer, timestamp);
          break;

        case 'Unstaked':
        case 'Reentered':
        case 'Withdraw':
          this.handlePSPLockedBalance(
            e as Unstaked | Reentered | Withdraw,
            timestamp,
          );
          break;

        case 'Entered':
          // noop nothing to get from this
          break;

        default:
          break;
      }
    });
  }

  handleSPSPBalance(e: Transfer, timestamp: number) {
    const [from, to, _value] = e.args;

    const value = new BigNumber(_value.toString());

    if (!this.differentialStates.sPSPBalanceByAccount[e.address]?.[from]) {
      this.differentialStates.sPSPBalanceByAccount[e.address] =
        this.differentialStates.sPSPBalanceByAccount[e.address] || {};
      this.differentialStates.sPSPBalanceByAccount[e.address][from] = [];
    }

    if (!this.differentialStates.sPSPBalanceByAccount[e.address]?.[to]) {
      this.differentialStates.sPSPBalanceByAccount[e.address] =
        this.differentialStates.sPSPBalanceByAccount[e.address] || {};
      this.differentialStates.sPSPBalanceByAccount[e.address][to] = [];
    }

    // mint
    if (from === NULL_ADDRESS) {
      this.differentialStates.sPSPBalanceByAccount[e.address][to].push({
        timestamp,
        value,
      });
      this.differentialStates.totalSupply[e.address].push({
        timestamp,
        value,
      });
      return;
    }

    // burn
    if (to === NULL_ADDRESS) {
      this.differentialStates.sPSPBalanceByAccount[e.address][to].push({
        timestamp,
        value: value.negated(),
      });
      this.differentialStates.totalSupply[e.address].push({
        timestamp,
        value: value.negated(),
      });

      return;
    }

    this.differentialStates.sPSPBalanceByAccount[e.address][from].push({
      timestamp,
      value: value.negated(),
    });

    this.differentialStates.sPSPBalanceByAccount[e.address][to].push({
      timestamp,
      value: value,
    });
  }

  handlePSPLockedBalance(
    e: Unstaked | Reentered | Withdraw,
    timestamp: number,
  ) {
    const poolAddress = e.address;
    const [, , amount] = e.args;

    const value = new BigNumber(amount.toString());

    if (!this.differentialStates.pspsLocked[poolAddress]) {
      this.differentialStates.pspsLocked[poolAddress] = [];
    }

    this.differentialStates.pspsLocked[poolAddress].push({
      timestamp,
      value: e.event === 'Unstaked' ? value : value.negated(),
    });
  }

  async resolvePSPBalanceChanges() {
    const events = (
      await Promise.all([
        PSPContract.queryFilter(
          PSPContract.filters.Transfer(SPSPAddresses),
          this.startBlock,
          this.endBlock,
        ),
        PSPContract.queryFilter(
          PSPContract.filters.Transfer(null, SPSPAddresses),
          this.startBlock,
          this.endBlock,
        ),
      ])
    ).flat() as Transfer[];

    const blockNumToTimestamp = await fetchBlockTimestampForEvents(events);

    events.forEach(e => {
      const timestamp = blockNumToTimestamp[e.blockNumber];
      const [from, to, _value] = e.args;
      const value = new BigNumber(_value.toString());
      const poolAddress = e.address;

      const transferFromSPSP = SPSPAddressesSet.has(from);
      const transferToSPSP = SPSPAddressesSet.has(to);

      assert(
        transferFromSPSP || transferToSPSP,
        'has to be transfer from or to SPSP',
      );

      if (!this.differentialStates.pspBalance[poolAddress])
        this.differentialStates.pspBalance[poolAddress] = [];

      this.differentialStates.pspBalance[poolAddress].push({
        timestamp,
        value: transferFromSPSP ? value.negated() : value,
      });
    });
  }

  computeStakedPSPBalance(_account: string, timestamp: number) {
    const account = _account.toLowerCase();

    const totalPSPBalance = SPSPAddresses.reduce((acc, poolAddress) => {
      const sPSPAmount = reduceTimeSeries(
        timestamp,
        this.initState.sPSPBalanceByAccount[poolAddress][account],
        this.differentialStates.sPSPBalanceByAccount[poolAddress][account],
      );
      const pspsLocked = reduceTimeSeries(
        timestamp,
        this.initState.pspsLocked[poolAddress],
        this.differentialStates.pspsLocked[poolAddress],
      );
      const totalSPSP = reduceTimeSeries(
        timestamp,
        this.initState.totalSupply[poolAddress],
        this.differentialStates.totalSupply[poolAddress],
      );
      const pspBalance = reduceTimeSeries(
        timestamp,
        this.initState.pspBalance[poolAddress],
        this.differentialStates.pspBalance[poolAddress],
      );

      const pspBalanceAvailable = pspBalance.minus(pspsLocked);

      const stakedPSPBalance = sPSPAmount
        .multipliedBy(pspBalanceAvailable)
        .dividedBy(totalSPSP);

      acc = acc.plus(stakedPSPBalance);

      return acc;
    }, ZERO_BN);

    return totalPSPBalance;
  }
}
