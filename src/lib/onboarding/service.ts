import { StakingService } from '../staking/staking';
import {
  createNewAccount,
  removeUserFromWaitlist,
  fetchAccountByUUID,
} from './mail-service-client';
import { RegisteredAccount, AccountToCreate, AuthToken } from './types';
import { fetchHistoricalPSPPrice } from './token-pricing';
import { BlockInfo } from '../block-info';
import { CHAIN_ID_MAINNET } from '../constants';
import { Provider } from '../provider';
import {
  AccountByEmailNotFoundError,
  AccountByUUIDNotFoundError,
  DuplicatedAccountError,
} from './errors';
import * as TestAddresses from './test-addresses.json';
import { generateAuthToken, createTester } from './beta-tester';
import { OnboardingAccount } from '../../models/OnboardingAccount';

const logger = global.LOGGER('OnBoardingService');

const IS_TEST = !process.env.NODE_ENV?.includes('prod');

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
    const ethereumProvider = Provider.getJsonRpcProvider(CHAIN_ID_MAINNET);

    const blockNumber =
      _blockNumber || (await ethereumProvider.getBlockNumber());

    const [pspPriceUsd, stakersWithStakes] = await Promise.all([
      this._fetchPSPPriceForBlock(blockNumber),
      StakingService.getInstance().getAllPSPStakersAllPrograms(blockNumber),
    ]);

    const eligibleAddresses = Object.entries(
      stakersWithStakes.pspStakersWithStake,
    ).reduce<string[]>((acc, [address, { pspStaked }]) => {
      if (this._hasEnoughStake(pspStaked, pspPriceUsd)) {
        acc.push(address.toLowerCase());
      }

      return acc;
    }, []);

    if (IS_TEST) {
      return eligibleAddresses.concat(TestAddresses.map(v => v.toLowerCase()));
    }

    return eligibleAddresses;
  }

  async _fetchPSPPriceForBlock(blockNumber: number): Promise<number> {
    const ethereumBlockSubGraph = BlockInfo.getInstance(CHAIN_ID_MAINNET);
    const ethereumProvider = Provider.getJsonRpcProvider(CHAIN_ID_MAINNET);

    const timestamp =
      (await ethereumBlockSubGraph.getBlockTimeStamp(blockNumber)) || // can be laggy if checking data for last 5min
      (await ethereumProvider.getBlock(blockNumber)).timestamp;

    const pspPriceUsd = await fetchHistoricalPSPPrice(timestamp);

    return pspPriceUsd;
  }

  async isAddressEligible(
    address: string,
    blockNumber: number,
  ): Promise<boolean> {
    if (
      IS_TEST &&
      TestAddresses.map(a => a.toLowerCase()).includes(address.toLowerCase())
    ) {
      return true;
    }

    const [{ pspStaked }, pspPriceUsd] = await Promise.all([
      StakingService.getInstance().getPSPStakesAllPrograms(
        address,
        blockNumber,
      ),
      this._fetchPSPPriceForBlock(blockNumber),
    ]);

    return this._hasEnoughStake(pspStaked, pspPriceUsd);
  }

  _hasEnoughStake(pspStaked: string, pspPriceUsd: number) {
    const stakeInUsd =
      Number(BigInt(pspStaked) / BigInt(10 ** 18)) * pspPriceUsd;

    return stakeInUsd >= ELIGIBILITY_USD_STAKE_THRESHOLD;
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
      const registeredAccount = await this._createNewAccount(account, true);

      return registeredAccount;
    } catch (e) {
      if (!(e instanceof DuplicatedAccountError)) throw e;

      const waitlistAccount = await this.getAccountByEmail(account);

      if (!waitlistAccount) {
        logger.error(
          `Logic error: account should always exist account with email ${account.email} has detected as duplicated but could not be found`,
        );
        throw e;
      }

      await this._removeUserFromWaitlist(waitlistAccount);
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
    try {
      return await this._createNewAccount(account, false);
    } catch (e) {
      if (e instanceof DuplicatedAccountError) {
        const accountByEmail = await this.getAccountByEmail(account);

        if (!!accountByEmail) return accountByEmail;
      }

      throw e;
    }
  }

  async _createNewAccount(account: AccountToCreate, isVerified: boolean) {
    const registeredAccount = await createNewAccount(account, isVerified);
    await OnboardingAccount.create(registeredAccount);

    return registeredAccount;
  }

  async _removeUserFromWaitlist(waitlistAccount: RegisteredAccount) {
    await removeUserFromWaitlist(waitlistAccount);
    await OnboardingAccount.destroy({
      where: {
        uuid: waitlistAccount.uuid,
      },
    });
  }

  // Note: service allows to search by uuid but not email.
  // Initially went for fetching all testers but too brute force + unrealiable (slow to sync)
  // Prefer falling back to database to lookup account by email.
  async getAccountByEmail({
    email,
  }: Pick<RegisteredAccount, 'email'>): Promise<RegisteredAccount | undefined> {
    const accountFromDb = await OnboardingAccount.findOne({
      where: {
        email,
      },
    });

    if (!accountFromDb) throw new AccountByEmailNotFoundError({ email });

    return accountFromDb;
  }

  async getAccountByUUID({
    uuid,
  }: Pick<RegisteredAccount, 'uuid'>): Promise<RegisteredAccount> {
    try {
      return await fetchAccountByUUID({ uuid });
    } catch (e) {
      const accountFromDb = await OnboardingAccount.findOne({
        where: {
          uuid,
        },
      });

      if (!accountFromDb) throw new AccountByUUIDNotFoundError({ uuid });

      return accountFromDb;
    }
  }

  _getAuthToken(): AuthToken {
    if (this.authToken && this.authToken.exp > Date.now() / 1000)
      return this.authToken;

    const authToken = generateAuthToken();

    this.authToken = authToken;

    return authToken;
  }
}
