import { StakingService } from '../staking/staking';
import {
  createNewAccount,
  removeUserFromWaitlist,
  fetchAccounts,
} from './mail-service-client';
import { RegisteredAccount, AccountToCreate, AuthToken } from './types';
import { fetchHistoricalPSPPrice } from './token-pricing';
import { BlockInfo } from '../block-info';
import { CHAIN_ID_MAINNET } from '../constants';
import { Provider } from '../provider';
import { AccountNotFoundError, DuplicatedAccountError } from './errors';
import * as pMemoize from 'p-memoize';
import * as QuickLRU from 'quick-lru';
import * as TestAddresses from './test-addresses.json';
import { generateAuthToken, createTester } from './beta-tester';

const logger = global.LOGGER('OnBoardingService');

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

  authToken?: AuthToken;

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

  async registerVerifiedAccount(
    account: AccountToCreate,
  ): Promise<RegisteredAccount> {
    const [registeredAccount] = await Promise.all([
      this._submitVerifiedEmailAccount(account),
      this._submitTester(account),
    ]);

    return registeredAccount;
  }

  async _submitVerifiedEmailAccount(
    account: AccountToCreate,
  ): Promise<RegisteredAccount> {
    try {
      const registeredAccount = await createNewAccount(account, true);

      return registeredAccount;
    } catch (e) {
      if (!(e instanceof DuplicatedAccountError)) throw e;

      const waitlistAccount = await this.getAccountByEmail(account);

      if (!waitlistAccount) {
        logger.error(
          `Logic error, account should exist account with email ${account.email} has detected as duplicated but could not be found`,
        );
        throw e;
      }

      await removeUserFromWaitlist(waitlistAccount);
      return await this._submitVerifiedEmailAccount(account);
    }
  }

  // this method should not crash the email submission flow to help on manual recovering
  async _submitTester(account: AccountToCreate): Promise<void> {
    try {
      await createTester({
        email: account.email,
        authToken: this._getAuthToken().token,
      });
    } catch (e) {
      logger.error(
        `Could not submit account with email ${account.email} to connect api`,
        e,
      );
    }
  }

  async submitAccountForWaitingList(
    account: AccountToCreate,
  ): Promise<RegisteredAccount> {
    const accountByEmail = await this.getAccountByEmail(account);

    if (!!accountByEmail) return accountByEmail;

    return createNewAccount(account, false);
  }

  async getAccountByEmail({
    email,
  }: {
    email: string;
  }): Promise<RegisteredAccount | undefined> {
    const accounts = await fetchAccounts();

    return accounts.find(account => account.email === email);
  }

  async getAccountByUUID({
    uuid,
  }: Pick<RegisteredAccount, 'uuid'>): Promise<RegisteredAccount> {
    const accounts = await fetchAccounts();

    const account = accounts.find(account => account.uuid === uuid);

    if (!account) throw new AccountNotFoundError({ uuid });

    return account;
  }

  _getAuthToken(): AuthToken {
    if (this.authToken && this.authToken.exp > Date.now() / 1000)
      return this.authToken;

    const authToken = generateAuthToken();

    this.authToken = authToken;

    return authToken;
  }
}
