import axios from 'axios';
import { assert } from 'ts-essentials';
import { StakingService } from './staking/staking';

const logger = global.LOGGER('OnboardingService');
const { MAIL_SERVICE_BASE_URL, MAIL_SERVICE_API_KEY } = process.env;

const PSP_THRESHOLD = BigInt(2750) * BigInt(10 ** 18);

type Account = {
  email: string;
  isEligible: boolean;
};

export const validateAccount = (payload: any): payload is Account => {
  return (
    !!payload &&
    typeof payload === 'object' &&
    typeof payload['email'] === 'string' &&
    typeof payload['isEligible'] === 'boolean'
  );
};

export class AccountNonValidError extends Error {
  constructor(payload: any) {
    super(
      `ValidationError: Invalid account format. Expecting {email: string, isEligibile: boolean}, received: ${JSON.stringify(
        payload,
      )}`,
    );
  }
}

export class AccountCreationError extends Error {
  constructor(account: Account) {
    super(
      `AccountCreationError: account=${JSON.stringify(
        account,
      )} did not get created.`,
    );
  }
}

export class DuplicatedAccountError extends Error {
  constructor(account: Account) {
    super(`DuplicatedErrorAccount: account=${JSON.stringify(account)}`);
  }
}

export class OnBoardingService {
  static instance: OnBoardingService;

  static getInstance() {
    if (!this.instance) {
      this.instance = new OnBoardingService();
    }
    return this.instance;
  }

  async getEligibleAddresses(blockNumber?: number): Promise<string[]> {
    const stakersWithStakes =
      await StakingService.getInstance().getAllPSPStakersAllPrograms(
        blockNumber,
      );

    const eligibleAddresses = Object.entries(
      stakersWithStakes.pspStakersWithStake,
    ).reduce<string[]>((acc, [address, { pspStaked }]) => {
      if (BigInt(pspStaked) >= PSP_THRESHOLD) {
        acc.push(address);
      }

      return acc;
    }, []);

    return eligibleAddresses;
  }

  async submitAccount(account: Account) {
    assert(MAIL_SERVICE_BASE_URL, 'set MAIL_SERVICE_BASE_URL env var');
    assert(MAIL_SERVICE_API_KEY, 'set MAIL_SERVICE_API_KEY env var');

    const apiUrl = `${MAIL_SERVICE_BASE_URL}/betas/17942/testers?api_key=${MAIL_SERVICE_API_KEY}`;

    const { isEligible, email } = account;

    const accountMail = isEligible
      ? {
          email,
          status: 'imported',
          groups: 'PSP stakers',
        }
      : {
          email,
          status: 'applied',
        };

    try {
      await axios.post(apiUrl, accountMail);
    } catch (e) {
      logger.error(e);
      if (e.response?.data?.errors?.[0]?.code === 2310)
        throw new DuplicatedAccountError(account);

      throw new AccountCreationError(account);
    }
  }
}
