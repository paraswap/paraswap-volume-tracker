import BigNumber from 'bignumber.js';
import { BigNumber as EthersBN, Contract, Event, EventFilter } from 'ethers';
import {
  CHAIN_ID_MAINNET,
  MULTICALL_ADDRESS,
  NULL_ADDRESS,
  PSP_ADDRESS,
} from '../../../src/lib/constants';
import { Provider } from '../../../src/lib/provider';
import * as ERC20ABI from '../../../src/lib/abi/erc20.abi.json';
import * as SPSPABI from '../../../src/lib/abi/spsp.abi.json';
import * as MultiCallerABI from '../../../src/lib/abi/multicaller.abi.json';
import { getTokenHolders } from './covalent';
import {
  fetchBlockTimestampForEvents,
  ONE_HOUR_SEC,
  startOfHourSec,
  ZERO_BN,
} from '../utils';
import { reduceTimeSeries, TimeSeries } from '../timeseries';
import { PoolConfigsMap } from '../../../src/lib/pool-info';
import AbstractStakeTracker from './abstract-stakes-tracker';
import { assert } from 'ts-essentials';

const logger = global.LOGGER('SPSPStakesTracker');

const SPSPAddresses = PoolConfigsMap[CHAIN_ID_MAINNET].filter(
  p => p.isActive,
).map(p => p.address.toLowerCase());

const SPSPAddressesSet = new Set(SPSPAddresses);

const SPSPPrototypeContract = new Contract(
  NULL_ADDRESS,
  SPSPABI,
  Provider.getJsonRpcProvider(CHAIN_ID_MAINNET),
);

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

const ONE_UNIT = (10 ** 18).toString();

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
    logger.info('Loading initial state');
    const initBlock = this.startBlock - 1;
    await Promise.all([
      this.fetchSPSPsState(initBlock),
      this.fetchSPSPsStakers(initBlock),
    ]);
    logger.info('Completed loading initial state');
  }

  async loadStateChanges() {
    logger.info('Loading state changes');
    await Promise.all([
      this.resolveInternalPoolChanges(),
      this.resolvePSPBalanceChanges(),
    ]);
    logger.info('Completed loading state changes');
  }

  async fetchSPSPsState(blockNumber: number) {
    logger.info(`Loading initial SPSP global states at block ${blockNumber}`);

    const chainId = CHAIN_ID_MAINNET;
    const provider = Provider.getJsonRpcProvider(chainId);
    const multicallContract = new Contract(
      MULTICALL_ADDRESS[chainId],
      MultiCallerABI,
      provider,
    );
    const multicallData = SPSPAddresses.flatMap(pool => [
      {
        target: pool,
        callData:
          SPSPPrototypeContract.interface.encodeFunctionData('totalSupply'),
      },
      {
        target: pool,
        callData:
          SPSPPrototypeContract.interface.encodeFunctionData('pspsLocked'),
      },
      {
        target: PSP_ADDRESS[chainId],
        callData: PSPContract.interface.encodeFunctionData('balanceOf', [pool]),
      },
    ]);

    const rawResult = await multicallContract.functions.aggregate(
      multicallData,
      {
        blockTag: blockNumber,
      },
    );

    SPSPAddresses.forEach((pool, i) => {
      const totalSupply = SPSPPrototypeContract.interface
        .decodeFunctionResult('totalSupply', rawResult.returnData[3 * i])
        .toString();

      const pspsLocked = SPSPPrototypeContract.interface
        .decodeFunctionResult('pspsLocked', rawResult.returnData[3 * i + 1])
        .toString();

      const pspBalance = PSPContract.interface
        .decodeFunctionResult('balanceOf', rawResult.returnData[3 * i + 2])
        .toString();

      this.initState.totalSupply[pool] = new BigNumber(totalSupply);
      this.initState.pspBalance[pool] = new BigNumber(pspBalance);
      this.initState.pspsLocked[pool] = new BigNumber(pspsLocked);
    }, {});

    logger.info(
      `Completed loading initial SPSP global states at block ${blockNumber}`,
    );
  }

  async fetchSPSPsStakers(blockNumber: number) {
    const chainId = CHAIN_ID_MAINNET;

    logger.info(
      `fetchSPSPsStakers: Loading initial sPSP balances at block ${blockNumber}`,
    );
    this.initState.sPSPBalanceByAccount = Object.fromEntries(
      await Promise.all(
        SPSPAddresses.map(async poolAddress => {
          // @WARNING pagination doesn't seem to work, so ask a large pageSize
          const options = {
            pageSize: 10000,
            token: poolAddress,
            chainId,
            blockHeight: String(blockNumber),
          };

          const { items } = await getTokenHolders(options);

          const stakesByAccount = Object.fromEntries(
            items.map(
              item =>
                [
                  item.address,
                  new BigNumber(item.balance), // wei
                ] as const,
            ),
          );

          return [poolAddress, stakesByAccount] as const;
        }),
      ),
    );
    logger.info(
      `fetchSPSPsStakers: Completed loading initial sPSP balances at block ${blockNumber}`,
    );
  }

  async resolveInternalPoolChanges() {
    logger.info(
      `resolveInternalPoolChanges: Loading multiple internal pool changes between ${this.startBlock} and ${this.endBlock}`,
    );
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

    logger.info(
      `resolveInternalPoolChanges: completed loading of ${allEventsAllPools.length} events across all pools between ${this.startBlock} and ${this.endBlock}`,
    );

    logger.info(`resolveInternalPoolChanges: loading blockNumToTimestamp`);
    const blockNumToTimestamp = await fetchBlockTimestampForEvents(
      allEventsAllPools,
    );
    logger.info(
      `resolveInternalPoolChanges: completed loading blockNumToTimestamp`,
    );

    allEventsAllPools.forEach(e => {
      const poolAddress = e.address.toLowerCase();

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

    logger.info(
      `resolveInternalPoolChanges: Finished treating all events of all pools between ${this.startBlock} and ${this.endBlock}`,
    );
  }

  handleSPSPBalance(e: Transfer, timestamp: number) {
    const [_from, _to, _value] = e.args;
    const from = _from.toLowerCase();
    const to = _to.toLowerCase();
    const value = new BigNumber(_value.toString());
    const poolAddress = e.address.toLowerCase();

    if (!this.differentialStates.sPSPBalanceByAccount[poolAddress]?.[from]) {
      this.differentialStates.sPSPBalanceByAccount[poolAddress] =
        this.differentialStates.sPSPBalanceByAccount[poolAddress] || {};
      this.differentialStates.sPSPBalanceByAccount[poolAddress][from] = [];
    }

    if (!this.differentialStates.sPSPBalanceByAccount[poolAddress]?.[to]) {
      this.differentialStates.sPSPBalanceByAccount[poolAddress] =
        this.differentialStates.sPSPBalanceByAccount[poolAddress] || {};
      this.differentialStates.sPSPBalanceByAccount[poolAddress][to] = [];
    }

    this.differentialStates.totalSupply[poolAddress] =
      this.differentialStates.totalSupply[poolAddress] || [];

    // mint
    if (from === NULL_ADDRESS) {
      this.differentialStates.sPSPBalanceByAccount[poolAddress][to].push({
        timestamp,
        value,
      });

      this.differentialStates.totalSupply[poolAddress].push({
        timestamp,
        value,
      });
      return;
    }

    // burn
    if (to === NULL_ADDRESS) {
      this.differentialStates.sPSPBalanceByAccount[poolAddress][from].push({
        timestamp,
        value: value.negated(),
      });
      this.differentialStates.totalSupply[poolAddress].push({
        timestamp,
        value: value.negated(),
      });

      return;
    }

    this.differentialStates.sPSPBalanceByAccount[poolAddress][from].push({
      timestamp,
      value: value.negated(),
    });

    this.differentialStates.sPSPBalanceByAccount[poolAddress][to].push({
      timestamp,
      value: value,
    });
  }

  handlePSPLockedBalance(
    e: Unstaked | Reentered | Withdraw,
    timestamp: number,
  ) {
    const poolAddress = e.address.toLowerCase();
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
    logger.info(
      `resolvePSPBalanceChanges: loading psp balance related events for all pools`,
    );

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

    logger.info(
      `resolvePSPBalanceChanges: completed loading ${events.length} psp balance related events for all pools`,
    );

    logger.info(`resolvePSPBalanceChanges: loading blockNumToTimestamp`);
    const blockNumToTimestamp = await fetchBlockTimestampForEvents(events);
    logger.info(
      `resolvePSPBalanceChanges: completed loading blockNumToTimestamp`,
    );

    events.forEach(e => {
      const timestamp = blockNumToTimestamp[e.blockNumber];
      const [_from, _to, _value] = e.args;
      const from = _from.toLowerCase();
      const to = _to.toLowerCase();
      const value = new BigNumber(_value.toString());

      const transferFromSPSP = SPSPAddressesSet.has(from);
      const transferToSPSP = SPSPAddressesSet.has(to);

      assert(
        transferFromSPSP || transferToSPSP,
        'has to be transfer from or to SPSP',
      );

      const poolAddress = transferFromSPSP ? from : to;

      if (!this.differentialStates.pspBalance[poolAddress])
        this.differentialStates.pspBalance[poolAddress] = [];

      this.differentialStates.pspBalance[poolAddress].push({
        timestamp,
        value: transferFromSPSP ? value.negated() : value,
      });
    });

    logger.info(
      `resolvePSPBalanceChanges: completed handling psp balance related events for all pools`,
    );
  }

  computeStakedPSPBalance(account: string, timestamp: number) {
    const totalPSPBalance = SPSPAddresses.reduce((acc, poolAddress) => {
      const sPSPAmount = reduceTimeSeries(
        timestamp,
        this.initState.sPSPBalanceByAccount[poolAddress]?.[account],
        this.differentialStates.sPSPBalanceByAccount[poolAddress]?.[account],
      );

      if (sPSPAmount.isZero()) return acc;

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

      return acc.plus(stakedPSPBalance);
    }, ZERO_BN);

    return totalPSPBalance;
  }

  // @LEGACY PURELY FOR BACKWARD COMPATIBILITY
  computeStakedPSPBalanceLegacy(
    _account: string,
    timestamp: number,
    endTimestamp: number,
  ) {
    const account = _account.toLowerCase();

    const startOfHourTimestampUnix = startOfHourSec(timestamp);
    const endOfHourTimestampUnix = startOfHourSec(timestamp + ONE_HOUR_SEC);

    const endOfHourLaterThanEpoch = endOfHourTimestampUnix > endTimestamp;

    const stakedPSPStartOfHour =
      this.computeStakedPSPBalanceWithPoorPrecisionLegacy(
        account,
        startOfHourTimestampUnix,
      );

    const stakedPSPEndOfHour = endOfHourLaterThanEpoch
      ? ZERO_BN
      : this.computeStakedPSPBalanceWithPoorPrecisionLegacy(
          account,
          endOfHourTimestampUnix,
        );

    return BigNumber.max(stakedPSPStartOfHour, stakedPSPEndOfHour);
  }

  // @LEGACY PURELY FOR BACKWARD COMPATIBILITY
  //compute PSPForSPSP for ONE_UINT then multiply with sPSP like previous way to guarantee same precision https://github.com/paraswap/paraswap-volume-tracker/blob/0584cc28d8da1126c818ba7ae89ac8d56cf52984/scripts/gas-refund-program/staking/spsp-stakes.ts#L91
  computeStakedPSPBalanceWithPoorPrecisionLegacy(
    account: string,
    timestamp: number,
  ) {
    const totalPSPBalance = SPSPAddresses.reduce((acc, poolAddress) => {
      const sPSPAmount = reduceTimeSeries(
        timestamp,
        this.initState.sPSPBalanceByAccount[poolAddress]?.[account],
        this.differentialStates.sPSPBalanceByAccount[poolAddress]?.[account],
      );

      if (sPSPAmount.isZero()) return acc;

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

      const pspForOneSPS = new BigNumber(ONE_UNIT)
        .multipliedBy(pspBalanceAvailable)
        .dividedBy(totalSPSP);

      const pspRate = new BigNumber(pspForOneSPS)
        .dividedBy(ONE_UNIT)
        .toNumber();

      const stakedPSPBalance = sPSPAmount.multipliedBy(pspRate);

      return acc.plus(stakedPSPBalance);
    }, ZERO_BN);

    return totalPSPBalance;
  }
}
