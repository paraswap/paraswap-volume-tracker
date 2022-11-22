import { BigNumber as EthersBN, Contract, Event } from 'ethers';
import { Provider } from '../../../../src/lib/provider';
import * as ERC20ABI from '../../../../src/lib/abi/erc20.abi.json';
import { fetchBlockTimestampForEvents } from '../../../../src/lib/utils/helpers';
import { reduceTimeSeries, TimeSeries } from '../../timeseries';
import BigNumber from 'bignumber.js';
import { AbstractStateTracker } from './AbstractStateTracker';
import { getTokenHolders } from '../../../../src/lib/utils/covalent';

const logger = global.LOGGER('ERC20StateTracker');

export interface Transfer extends Event {
  event: 'Transfer';
  args: [from: string, to: string, value: EthersBN] & {
    from: string;
    to: string;
    value: BigNumber;
  };
}

type InitState = {
  balance: {
    [accountAddress: string]: BigNumber;
  };
};

type DiffState = {
  balance: {
    [accountAddress: string]: TimeSeries;
  };
};

export default class ERC20StateTracker extends AbstractStateTracker {
  contract: Contract;

  initState: InitState = {
    balance: {},
  };
  differentialStates: DiffState = {
    balance: {},
  };

  transferEvents: Transfer[];

  static instance: {
    [chainId: number]: {
      [contractAddress: string]: ERC20StateTracker;
    };
  } = {};

  static getInstance(chainId: number, contractAddress: string) {
    if (!this.instance[chainId]) {
      this.instance[chainId] = {};
    }
    if (!this.instance[chainId][contractAddress]) {
      this.instance[chainId][contractAddress] = new ERC20StateTracker(
        chainId,
        contractAddress,
      );
    }

    return this.instance[chainId][contractAddress];
  }

  constructor(protected chainId: number, protected contractAddress: string) {
    super(chainId);

    this.contract = new Contract(
      contractAddress,
      ERC20ABI,
      Provider.getJsonRpcProvider(chainId),
    );
  }

  async loadStates() {
    await Promise.all([this.loadInitialState(), this.loadStateChanges()]);
  }

  async loadInitialState() {
    logger.info('Loading initial state');
    const initBlock = this.startBlock - 1;

    const options = {
      token: this.contractAddress,
      chainId: this.chainId,
      blockHeight: String(initBlock),
    };

    const stakes = await getTokenHolders(options);

    this.initState.balance = stakes.reduce<{
      [accountAddress: string]: BigNumber;
    }>((acc, curr) => {
      acc[curr.address.toLowerCase()] = new BigNumber(curr.balance);
      return acc;
    }, {});
  }

  async loadStateChanges() {
    logger.info(
      `loadStateChanges: loading psp balance related events for all pools`,
    );

    const events = (this.transferEvents = (await this.contract.queryFilter(
      this.contract.filters.Transfer(),
      this.startBlock,
      this.endBlock,
    )) as Transfer[]);

    logger.info(
      `loadStateChanges: completed loading ${events.length} psp balance related events for all pools`,
    );

    logger.info(`loadStateChanges: loading blockNumToTimestamp`);
    const blockNumToTimestamp = await fetchBlockTimestampForEvents(events);
    logger.info(`loadStateChanges: completed loading blockNumToTimestamp`);

    events.forEach(e => {
      const timestamp = blockNumToTimestamp[e.blockNumber];
      const [_from, _to, _value] = e.args;
      const from = _from.toLowerCase();
      const to = _to.toLowerCase();
      const value = new BigNumber(_value.toString());

      if (!this.differentialStates.balance)
        this.differentialStates.balance = {};

      if (!this.differentialStates.balance[from])
        this.differentialStates.balance[from] = [];

      if (!this.differentialStates.balance[to])
        this.differentialStates.balance[to] = [];

      this.differentialStates.balance[from].push({
        timestamp,
        value: value.negated(),
      });

      this.differentialStates.balance[to].push({
        timestamp,
        value,
      });
    });

    logger.info(
      `loadStateChanges: completed handling psp balance related events for all pools`,
    );
  }

  getBalance(timestamp: number, account: string) {
    this.assertTimestampWithinLoadInterval(timestamp);

    const balance = reduceTimeSeries(
      timestamp,
      this.initState.balance[account],
      this.differentialStates.balance[account],
    );

    return balance;
  }
}
