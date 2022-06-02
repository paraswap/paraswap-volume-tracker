import { StakingService } from '../staking/staking';
import { createNewAccount, fetchAccounts } from './mail-service-client';
import { RegisteredAccount, AccountToCreate } from './types';
import { fetchSpotPSPUsdPrice } from './token-pricing';

export const validateAccount = (payload: any): payload is AccountToCreate => {
  return (
    !!payload &&
    typeof payload === 'object' &&
    typeof payload['email'] === 'string'
  );
};

export class AccountNonValidError extends Error {
  constructor(payload: any) {
    super(
      `ValidationError: Invalid account format. Expecting {email: string}, received: ${JSON.stringify(
        payload,
      )}`,
    );
  }
}

export class AccountNotFoundError extends Error {
  constructor(uuid: string) {
    super(`Account not found uuid=${uuid}`);
  }
}

const ELIGIBILITY_USD_STAKE_THRESHOLD = 100;

export class OnBoardingService {
  static instance: OnBoardingService;

  static getInstance() {
    if (!this.instance) {
      this.instance = new OnBoardingService();
    }
    return this.instance;
  }

  async getEligibleAddresses(): Promise<string[]> {
    const pspPriceUsd = await fetchSpotPSPUsdPrice();
    const stakersWithStakes =
      await StakingService.getInstance().getAllPSPStakersAllPrograms();

    const eligibleAddresses = Object.entries(
      stakersWithStakes.pspStakersWithStake,
    ).reduce<string[]>((acc, [address, { pspStaked }]) => {
      const stakeInUsd =
        Number(BigInt(pspStaked) / BigInt(10 ** 18)) * pspPriceUsd;

      if (stakeInUsd >= ELIGIBILITY_USD_STAKE_THRESHOLD) {
        acc.push(address);
      }

      return acc;
    }, []);

    return eligibleAddresses;
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
