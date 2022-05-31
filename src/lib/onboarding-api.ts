import axios from 'axios';
import { assert } from 'ts-essentials';
import { StakingService } from './staking/staking';
import { coingeckoClient } from '../lib/utils/data-providers-clients';

const logger = global.LOGGER('OnboardingService');
const { MAIL_SERVICE_BASE_URL, MAIL_SERVICE_API_KEY } = process.env;

type Account = {
  email: string;
};

export const validateAccount = (payload: any): payload is Account => {
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

export async function fetchSpotPSPUsdPrice(): Promise<number> {
  const url = `https://api.coingecko.com/api/v3/coins/paraswap?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`;
  const {
    data: {
      market_data: {
        current_price: { usd },
      },
    },
  } = await coingeckoClient.get<{
    market_data: { current_price: { usd: number } };
  }>(url);

  return usd;
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

  async submitVerifiedAccount(account: Account) {
    assert(MAIL_SERVICE_BASE_URL, 'set MAIL_SERVICE_BASE_URL env var');
    assert(MAIL_SERVICE_API_KEY, 'set MAIL_SERVICE_API_KEY env var');

    const apiUrl = `${MAIL_SERVICE_BASE_URL}/betas/17942/testers?api_key=${MAIL_SERVICE_API_KEY}`;

    const { email } = account;

    const accountMail = {
      email,
      status: 'imported',
      groups: 'PSP stakers',
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
