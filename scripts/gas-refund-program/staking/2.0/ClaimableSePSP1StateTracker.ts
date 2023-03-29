import {
  reduceTimeSeries,
  TimeSeries,
} from '../../timeseries';
import { AbstractStateTracker } from './AbstractStateTracker';
import BigNumber from 'bignumber.js';
import { MerkleRedeemHelperSePSP1 } from './MerkleRedeemHelperSePSP1';
import { getEpochStartCalcTime, resolveV2EpochNumber } from '../../../../src/lib/gas-refund/epoch-helpers';
import { assert } from 'ts-essentials';
import { CHAIN_ID_MAINNET } from '../../../../src/lib/constants';
import { Event, BigNumber as EthersBN, Contract } from 'ethers';
import * as MerkleRedeemAbi from '../../../../src/lib/abi/merkle-redeem.abi.json';
import { Provider } from '../../../../src/lib/provider';
import { fetchBlockTimestampForEvents } from '../../../../src/lib/utils/helpers';
import { BlockInfo } from '../../../../src/lib/block-info';
import { MerkleRedeemAddressSePSP1 } from '../../../../src/lib/gas-refund/gas-refund-api';

const logger = global.LOGGER('ClaimableSePSP1StateTracker');

export interface Claimed extends Event {
  event: 'Claimed';
  args: [_claimant: string, _balance: EthersBN] & {
    _claimant: string;
    _balance: EthersBN;
  };
}

type TimeSeriesByAccount = {
  [accountAddress: string]: TimeSeries;
}

type InitState = {
  balance: {
    [accountAddress: string]: BigNumber;
  }
};

type DiffState = {
  balance: TimeSeriesByAccount
};

const EPOCH_WHEN_SWITCHED_TO_SE_PSP1 = 32;


export default class ClaimableSePSP1StateTracker extends AbstractStateTracker {
  initState: InitState = {
    balance: {}
  };
  differentialStates: DiffState = {
    // consists of claims (+value) and distributions (-value)
    balance: {}
  };
  contract: Contract;

  static instance: { [chainId: number]: ClaimableSePSP1StateTracker } = {};

  static getInstance(chainId: number) {
    if (!this.instance[chainId]) {
      this.instance[chainId] = new ClaimableSePSP1StateTracker(chainId);
    }
    return this.instance[chainId];
  }

  constructor(protected network: number) {
    super(network);
    assert(network === CHAIN_ID_MAINNET, 'must be mainnet')

    this.contract = new Contract(
      MerkleRedeemAddressSePSP1[this.network],
      MerkleRedeemAbi,
      Provider.getJsonRpcProvider(this.network),
    );
  }

  async loadStates() {
    await Promise.all([this.loadInitialState(), this.loadStateChanges()]);
  }

  async _getClaimsTimeSeriesByAccount(fromBlock: number, toBlock: number): Promise<TimeSeriesByAccount> {
    // infura log query limit is 10_000 items and 10 seconds timeout. Consider optimizing this https://docs.infura.io/infura/networks/ethereum/json-rpc-methods/eth_getlogs#limitations
    // especially when fetching from epoch 32 to start
    try {
      const events = (await this.contract.queryFilter(
        this.contract.filters.Claimed(),
        fromBlock,
        toBlock,
      )) as Claimed[];

      const blockNumToTimestamp = await fetchBlockTimestampForEvents(
        this.chainId,
        events,
      );

      const timeSeriesByAccount = events.reduce((acc, event) => {
        const timestamp = blockNumToTimestamp[event.blockNumber];
        const claimantLowercase = event.args._claimant.toLowerCase();
        if (!acc[claimantLowercase])
          acc[claimantLowercase] = [];

        acc[claimantLowercase].push({
          timestamp,
          value: new BigNumber(event.args._balance.toString()).multipliedBy(-1),
        })
        return acc;

      }, {} as TimeSeriesByAccount);
      return timeSeriesByAccount;
    } catch (e) {
      logger.error("error when fetching claims", e);
      throw e;
    }
  }

  async getClaimsFromEpoch32ToStartEpoch(): Promise<TimeSeriesByAccount> {
    // epoch 33 has already started when users started claiming sePSP1 (first distribution in sePSP for epoch 32 + grace period + pending period)
    const timestampWhenStartedClaimingSePSP1 = await getEpochStartCalcTime(33);
    const blockWhenStartedClaimingSePSP1 = await BlockInfo.getInstance(this.network).getBlockAfterTimeStamp(timestampWhenStartedClaimingSePSP1);

    assert(blockWhenStartedClaimingSePSP1);
    // if we are before epoch 33, there are no claims
    if (this.startBlock < blockWhenStartedClaimingSePSP1) return {}
    return this._getClaimsTimeSeriesByAccount(blockWhenStartedClaimingSePSP1, this.startBlock);
  }

  async _getDistributionsTimeSeriesByAccount(filterEpoch: (epoch: number) => boolean) {
    const merkleDataByEpoch = await MerkleRedeemHelperSePSP1.getInstance().getMerkleDataByEpoch();
    const epochsDistributedWithinInterval = Object.keys(merkleDataByEpoch).map(Number).filter(filterEpoch);
    if (epochsDistributedWithinInterval.length === 0) return {}

    const timestampsOfNthPlusOneEpoch = await Promise.all(epochsDistributedWithinInterval
      .map(epoch => epoch + 1) // sePSP1 earned at epoch N is accrued at epoch N+1
      .map(getEpochStartCalcTime))

    const accrualTimestampByEpoch = epochsDistributedWithinInterval.reduce((acc, epoch, i) => {
      acc[epoch] = timestampsOfNthPlusOneEpoch[i];
      return acc;
    }, {} as { [epoch: number]: number })

    // we consider sePSP1 belonging to the user right from the beginning of next epoch, right? Rrriight?
    const timeSeriesByAccount = epochsDistributedWithinInterval.reduce((acc, epoch) => {
      const timestamp = accrualTimestampByEpoch[epoch];
      merkleDataByEpoch[epoch].leaves.forEach(({ address, amount }) => {
        if (!acc[address])
          acc[address] = [];

        acc[address].push({
          timestamp,
          value: new BigNumber(amount),
        })
      })
      return acc;
    }, {} as TimeSeriesByAccount);
    return timeSeriesByAccount;
  }

  async getDistributionsFromEpoch32ToStartEpoch(): Promise<TimeSeriesByAccount> {
    const startEpoch = resolveV2EpochNumber(this.startTimestamp);
    // sePSP1 started being accrued since epoch 33, so early return for earlier epochs
    if (startEpoch <= EPOCH_WHEN_SWITCHED_TO_SE_PSP1) return {}

    const epochsDistributedByTheStart: (epoch: number) => boolean = epoch => epoch < startEpoch
    return this._getDistributionsTimeSeriesByAccount(epochsDistributedByTheStart);

  }

  async loadInitialState() {
    // initial state = sumDistributions(from epoch 32 to startEpoch) - sumClaims(from epoch 32 to startEpoch)
    const [distributionsFromEpoch32ToStartEpoch, claimsFromEpoch32ToStartEpoch] = await Promise.all(
      [this.getDistributionsFromEpoch32ToStartEpoch(), this.getClaimsFromEpoch32ToStartEpoch()]
    )
    const allParticipantsFromEpoch32ToStartEpoch = Object.keys(distributionsFromEpoch32ToStartEpoch);
    const balance: InitState['balance'] = allParticipantsFromEpoch32ToStartEpoch.reduce((acc, account) => {
      acc[account] = reduceTimeSeries(this.startTimestamp, undefined, distributionsFromEpoch32ToStartEpoch[account])
      acc[account].plus(reduceTimeSeries(this.startTimestamp, undefined, claimsFromEpoch32ToStartEpoch[account]))
      return acc;
    }, {} as InitState['balance'])

    this.initState = { balance }
  }

  async loadStateChanges() {
    const [epochFrom, epochTo] = await Promise.all([resolveV2EpochNumber(this.startTimestamp), resolveV2EpochNumber(this.endTimestamp)]);
    const distributions = await this._getDistributionsTimeSeriesByAccount(
      epoch => epoch >= epochFrom  // epochFrom not included into initialState, so included here
        && epoch < epochTo  // epochTo hasn't been distributed yet, so not included
    );


    const claims = await this._getClaimsTimeSeriesByAccount(
      this.startBlock + 1, // startBlock already included into initialState, so increment here
      this.endBlock
    )

    const allAccounts = new Set(Object.keys(distributions).concat(Object.keys(claims)));
    const balance: DiffState['balance'] = Array.from(allAccounts).reduce((acc, account) => {
      acc[account] = (distributions[account] || []).concat(claims[account] || []);
      return acc;
    }, {} as DiffState['balance'])

    this.differentialStates = { balance }
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
