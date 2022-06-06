import { StakingService } from '../staking/staking';
import { createNewAccount, fetchAccounts } from './mail-service-client';
import { RegisteredAccount, AccountToCreate } from './types';
import { fetchHistoricalPSPPrice } from './token-pricing';
import { BlockInfo } from '../block-info';
import { CHAIN_ID_MAINNET } from '../constants';
import { Provider } from '../provider';
import { AccountNotFoundError } from './errors';
import * as pMemoize from 'p-memoize';
import * as QuickLRU from 'quick-lru';
import * as TestAddresses from './test-addresses.json';

const IS_TEST = !process.env.NODE_ENV?.includes('prod');

const getAllPSPStakersAllProgramsCached = pMemoize(
  StakingService.getInstance().getAllPSPStakersAllPrograms,
  {
    cache: new QuickLRU({
      maxSize: 100,
    }),
  },
);

export const validateAccount = (payload: any): payload is AccountToCreate => {
  return (
    !!payload &&
    typeof payload === 'object' &&
    typeof payload['email'] === 'string'
  );
};

const ELIGIBILITY_USD_STAKE_THRESHOLD = 100;

export class OnBoardingService {
  static instance: OnBoardingService;

  static getInstance() {
    if (!this.instance) {
      this.instance = new OnBoardingService();
    }
    return this.instance;
  }

  async getEligibleAddresses(_blockNumber?: number): Promise<string[]> {
    const ethereumBlockSubGraph = BlockInfo.getInstance(CHAIN_ID_MAINNET);
    const ethereumProvider = Provider.getJsonRpcProvider(CHAIN_ID_MAINNET);

    const blockNumber =
      _blockNumber || (await ethereumProvider.getBlockNumber());

    const timestamp =
      (await ethereumBlockSubGraph.getBlockTimeStamp(blockNumber)) ||
      (await ethereumProvider.getBlock(blockNumber)).timestamp;

    const pspPriceUsd = await fetchHistoricalPSPPrice(timestamp);

    const stakersWithStakes = await getAllPSPStakersAllProgramsCached(
      _blockNumber,
    );

    const eligibleAddresses = Object.entries(
      stakersWithStakes.pspStakersWithStake,
    ).reduce<string[]>((acc, [address, { pspStaked }]) => {
      const stakeInUsd =
        Number(BigInt(pspStaked) / BigInt(10 ** 18)) * pspPriceUsd;

      if (stakeInUsd >= ELIGIBILITY_USD_STAKE_THRESHOLD) {
        acc.push(address.toLowerCase());
      }

      return acc;
    }, []);

    if (IS_TEST) {
      return eligibleAddresses.concat(TestAddresses);
    }

    return eligibleAddresses;
  }

  async isAddressEligible(
    address: string,
    blockNumber: number,
  ): Promise<boolean> {
    const eligibleAddresses = await this.getEligibleAddresses(blockNumber);

    const isEligible = eligibleAddresses.includes(address.toLowerCase());

    return isEligible;
  }

  async submitVerifiedAccount(
    account: AccountToCreate,
  ): Promise<RegisteredAccount> {
    return createNewAccount(account, true);
  }

  async submitAccountForWaitingList(
    account: AccountToCreate,
  ): Promise<RegisteredAccount> {
    const accountByEmail = await this.getAccountByEmail(account.email);

    if (!!accountByEmail) return accountByEmail;

    return createNewAccount(account, false);
  }

  async getAccountByEmail(
    email: string,
  ): Promise<RegisteredAccount | undefined> {
    const accounts = await fetchAccounts();

    return accounts.find(account => account.email === email);
  }

  async getAccountByUUID(uuid: string): Promise<RegisteredAccount> {
    const accounts = await fetchAccounts();

    const account = accounts.find(account => account.uuid === uuid);

    if (!account) throw new AccountNotFoundError(uuid);

    return account;
  }
}
