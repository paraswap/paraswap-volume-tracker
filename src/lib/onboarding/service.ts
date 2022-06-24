import { StakingService } from '../staking/staking';
import {
  createNewAccount,
  removeUserFromWaitlist,
  fetchAccountByUUID,
} from './mail-service-client';
import {
  RegisteredAccount,
  AccountToCreate,
  AuthToken,
  AccountWithSigToSubmit,
  AccountGroup,
  AccountToCreateWithResponse,
} from './types';
import { fetchHistoricalPSPPrice } from './token-pricing';
import { BlockInfo } from '../block-info';
import { CHAIN_ID_MAINNET } from '../constants';
import { Provider } from '../provider';
import {
  AccountByEmailNotFoundError,
  AccountByUUIDNotFoundError,
  AccountNotEligible,
  DuplicatedAccountError,
  DuplicatedAccountWithSigError,
  DuplicatedStakerEmail,
  InvalidSigErrror,
} from './errors';
import * as TestAddresses from './test-addresses.json';
import { generateAuthToken, createTester } from './beta-tester';
import { OnboardingAccount } from '../../models/OnboardingAccount';
import { OnboardingSig } from '../../models/OnboardingSig';
import { isSigValid } from './sig';
import Database from '../../database';
import { Transaction as DBTransaction } from 'sequelize/types';
import { isValidEmailAddr } from '../utils/helpers';
import { isAddress } from '@ethersproject/address';
import { verifyKey } from './verification-service';

const logger = global.LOGGER('OnBoardingService');

const IS_TEST = !process.env.NODE_ENV?.includes('prod');

export const isValidAccount = (payload: any): payload is AccountToCreate => {
  return (
    !!payload &&
    typeof payload === 'object' &&
    isValidEmailAddr(payload['email'])
  );
};

/// FALLBACK ONLY
export const isValidAccountWithSig = (
  payload: any,
): payload is AccountWithSigToSubmit => {
  return (
    !!payload &&
    typeof payload === 'object' &&
    isValidEmailAddr(payload['email']) &&
    isAddress(payload['address']) &&
    typeof payload['sig'] === 'string' &&
    payload['sig'].startsWith('0x') &&
    typeof payload['version'] === 'number'
  );
};

export const isValidAccountWithResponse = (
  payload: any,
): payload is AccountToCreateWithResponse => {
  if (!isValidAccount(payload)) return false;

  const _payload: Record<string, any> = payload;

  return typeof _payload['response'] === 'string' && !!_payload['response'];
};

const ELIGIBILITY_USD_STAKE_THRESHOLD = 100;

export class OnBoardingService {
  static instance: OnBoardingService;

  authToken?: AuthToken;
  chainId = CHAIN_ID_MAINNET;

  static getInstance() {
    if (!this.instance) {
      this.instance = new OnBoardingService();
    }
    return this.instance;
  }

  async getEligibleAddresses(_blockNumber?: number): Promise<string[]> {
    const ethereumProvider = Provider.getJsonRpcProvider(this.chainId);

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

  async _fetchPSPPriceForBlock(blockNumber?: number): Promise<number> {
    const ethereumBlockSubGraph = BlockInfo.getInstance(this.chainId);
    const ethereumProvider = Provider.getJsonRpcProvider(this.chainId);

    const timestamp = blockNumber
      ? (await ethereumBlockSubGraph.getBlockTimeStamp(blockNumber)) || // can be laggy if checking data for last 5min
        (await ethereumProvider.getBlock(blockNumber)).timestamp
      : Math.floor(Date.now() / 1000);

    const pspPriceUsd = await fetchHistoricalPSPPrice(timestamp);

    return pspPriceUsd;
  }

  async isAddressEligible(
    address: string,
    blockNumber?: number,
  ): Promise<boolean> {
    if (IS_TEST && TestAddresses.map(a => a.toLowerCase()).includes(address)) {
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

  async _registerVerifiedAccount(
    account: AccountToCreate,
    dbTransaction: DBTransaction,
  ): Promise<RegisteredAccount> {
    const [registeredAccount] = await Promise.all([
      this._submitVerifiedEmailAccount(account, dbTransaction),
      this._submitTester(account),
    ]);

    return registeredAccount;
  }

  async registerVerifiedAccount(
    account: AccountToCreate,
  ): Promise<RegisteredAccount> {
    return Database.sequelize.transaction(transaction => {
      return this._registerVerifiedAccount(account, transaction);
    });
  }

  async _submitVerifiedEmailAccount(
    account: AccountToCreate,
    dbTransaction: DBTransaction,
  ): Promise<RegisteredAccount> {
    try {
      const registeredAccount = await this._createNewAccount(
        account,
        true,
        dbTransaction,
      );

      return registeredAccount;
    } catch (e) {
      if (!(e instanceof DuplicatedAccountError)) throw e;

      const waitlistAccount = await this.getAccountByEmail(
        account,
        dbTransaction,
      );

      if (!waitlistAccount) {
        logger.error(
          `Logic error: account should always exist account with email ${account.email} has detected as duplicated but could not be found`,
        );
        throw e;
      }

      if (waitlistAccount.groups === AccountGroup.PSP_STAKERS) {
        throw new DuplicatedStakerEmail(account);
      }

      await this._removeUserFromWaitlist(waitlistAccount, dbTransaction);
      return await this._submitVerifiedEmailAccount(account, dbTransaction);
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
    account: AccountToCreateWithResponse,
  ): Promise<RegisteredAccount> {
    return await Database.sequelize.transaction(async transaction => {
      try {
        await verifyKey(account.response);
        return await this._createNewAccount(account, false, transaction);
      } catch (e) {
        if (e instanceof DuplicatedAccountError) {
          const accountByEmail = await this.getAccountByEmail(
            account,
            transaction,
          );

          if (!!accountByEmail) return accountByEmail;
        }

        throw e;
      }
    });
  }

  async _createNewAccount(
    account: AccountToCreate,
    isVerified: boolean,
    dbTransaction: DBTransaction,
  ) {
    const registeredAccount = await createNewAccount(account, isVerified);
    await OnboardingAccount.create(registeredAccount, {
      transaction: dbTransaction,
    });

    return registeredAccount;
  }

  async _removeUserFromWaitlist(
    waitlistAccount: RegisteredAccount,
    dbTransaction: DBTransaction,
  ) {
    await removeUserFromWaitlist(waitlistAccount);
    await OnboardingAccount.destroy({
      where: {
        uuid: waitlistAccount.uuid,
      },
      transaction: dbTransaction,
    });
  }

  // Note: service allows to search by uuid but not email.
  // Initially went for fetching all testers but too brute force + unrealiable (slow to sync)
  // Prefer falling back to database to lookup account by email.
  async getAccountByEmail(
    { email }: Pick<RegisteredAccount, 'email'>,
    dbTransaction: DBTransaction,
  ): Promise<RegisteredAccount | undefined> {
    const accountFromDb = await OnboardingAccount.findOne({
      where: {
        email,
      },
      transaction: dbTransaction,
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

  /// FALLBACK ONLY
  async submitAccountWithSig(accountWithSig: AccountWithSigToSubmit) {
    return Database.sequelize.transaction(async transaction => {
      const { address, email } = accountWithSig;

      const isEligible = await this.isAddressEligible(address);

      if (!isEligible) throw new AccountNotEligible();

      if (
        (await OnboardingSig.count({
          where: { address },
          transaction,
        })) > 0
      )
        throw new DuplicatedAccountWithSigError(accountWithSig);

      const isValid = await isSigValid({
        ...accountWithSig,
        chainId: this.chainId,
      });

      if (!isValid) throw new InvalidSigErrror(accountWithSig);

      // note: email is not persisted here
      await OnboardingSig.create(accountWithSig, {
        transaction,
      });

      return this._registerVerifiedAccount({ email }, transaction);
    });
  }
}
