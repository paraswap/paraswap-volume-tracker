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
import { getTokenHolders } from './covalent';
import { fetchBlockTimestampForEvents, ZERO_BN } from '../utils';
import {
  reduceTimeSeries,
  TimeSeries,
  timeseriesComparator,
} from '../timeseries';
import { PoolConfigsMap } from '../../../src/lib/pool-info';
import AbstractStakeTracker from './abstract-stakes-tracker';

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
  ERC20ABI,
  Provider.getJsonRpcProvider(CHAIN_ID_MAINNET),
) as MinSPSP;

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
  balances: { [poolAddress: string]: { [accountAddress: string]: BigNumber } };
};

type DiffState = {
  totalSupply: { [poolAddress: string]: TimeSeries };
  pspBalance: { [poolAddress: string]: TimeSeries };
  pspsLocked: { [poolAddress: string]: TimeSeries };
  balances: { [poolAddress: string]: { [accountAddress: string]: TimeSeries } };
};

export default class SPSPStakesTracker extends AbstractStakeTracker {
  initState: InitState = {
    totalSupply: {},
    pspBalance: {},
    pspsLocked: {},
    balances: {},
  };
  differentialStates: DiffState = {
    totalSupply: {},
    pspBalance: {},
    pspsLocked: {},
    balances: {},
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
      switch (event) {
        case 'Transfer':
          this.handleTransfer(e as Transfer);
          break;
        case 'Entered':
          this.handleEntered(e as Entered);
          break;
        case 'Unstaked':
          this.handleUnstaked(e as Unstaked);
          break;
        case 'Reentered':
          this.handleReentered(e as Reentered);
          break;
        case 'Withdraw':
          this.handleWithdraw(e as Withdraw);
          break;

        default:
          break;
      }
    });
  }

  handleTransfer(e: Transfer) {}
  handleUnstaked(e: Unstaked) {}
  handleWithdraw(e: Withdraw) {}
  handleEntered(e: Entered) {}
  handleReentered(e: Reentered) {}

  async resolvePSPBalanceChanges() {
    // @TODO resolve PSP movements
  }

  // @todo handle legacy (hourly intervals)
  computeStakedPSPBalance(_account: string, timestamp: number) {
    const account = _account.toLowerCase();

    const totalPSPBalance = SPSPAddresses.reduce((acc, poolAddress) => {
      const sPSPAmount = reduceTimeSeries(
        timestamp,
        this.initState.balances[poolAddress][account],
        this.differentialStates.balances[poolAddress][account],
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
