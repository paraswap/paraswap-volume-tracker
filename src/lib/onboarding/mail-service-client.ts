import * as _ from 'lodash';
import { assert } from 'ts-essentials';
import { constructHttpClient } from '../utils/http-client';
import {
  AccountCreationError,
  AccountDeleteError,
  DuplicatedAccountError,
} from './errors';
import { AccountToCreate, RegisteredAccount, AccountStatus } from './types';

const logger = global.LOGGER('MailService');

const { MAIL_SERVICE_BASE_URL, MAIL_SERVICE_API_KEY } = process.env;

type MinStore = {
  // store is typed as object in lib
  clear: () => void;
};

const mailServiceClient = constructHttpClient({
  cacheOptions: {
    maxAge: 2 * 1000,
    limit: 1,
    exclude: {
      query: false, // apikey is passed through query param
    },
    invalidate: async (cfg, req) => {
      const method = req?.method?.toLowerCase();
      if (method !== 'get') {
        // account creation would clear store and force refetching list of accounts
        await (cfg?.store as MinStore)?.clear();
      }
    },
  },
});

type RawRegisteredAccount = RegisteredAccount & Record<string, unknown>;

function sanitizeAccount(
  rawRegisteredAccount: RawRegisteredAccount,
): RegisteredAccount {
  return _.pick(rawRegisteredAccount, [
    'uuid',
    'email',
    'status',
    'share_clicks_count',
    'share_signups_count',
    'share_link',
    'share_status_link',
    'waitlist_position',
  ]);
}

// service present some latency (5min observed). Creating account then trying to retrieve it right away would likely fail.
export async function createNewAccount(
  account: AccountToCreate,
  isVerified: boolean,
): Promise<RegisteredAccount> {
  assert(MAIL_SERVICE_BASE_URL, 'set MAIL_SERVICE_BASE_URL env var');
  assert(MAIL_SERVICE_API_KEY, 'set MAIL_SERVICE_API_KEY env var');

  const apiUrl = `${MAIL_SERVICE_BASE_URL}/betas/17942/testers?api_key=${MAIL_SERVICE_API_KEY}`;

  const createdAccount = {
    ...account,
    ...(isVerified
      ? {
          status: AccountStatus.IMPORTED,
          groups: 'PSP stakers',
        }
      : {
          status: AccountStatus.APPLIED,
          groups: 'Waitlist',
        }),
  };
  try {
    const { data: registeredAccount } =
      await mailServiceClient.post<RawRegisteredAccount>(apiUrl, {
        tester: createdAccount,
      });

    return sanitizeAccount(registeredAccount);
  } catch (e) {
    if (e.response?.data?.errors?.[0]?.code === 2310)
      throw new DuplicatedAccountError(account);

    logger.error(e);

    throw new AccountCreationError(account);
  }
}

export async function removeUserFromWaitlist({
  uuid,
}: Pick<RegisteredAccount, 'uuid'>): Promise<void> {
  assert(MAIL_SERVICE_BASE_URL, 'set MAIL_SERVICE_BASE_URL env var');
  assert(MAIL_SERVICE_API_KEY, 'set MAIL_SERVICE_API_KEY env var');

  const apiUrl = `${MAIL_SERVICE_BASE_URL}/betas/17942/testers/${uuid}?api_key=${MAIL_SERVICE_API_KEY}`;

  try {
    await mailServiceClient.delete(apiUrl);
  } catch (e) {
    throw new AccountDeleteError({ uuid });
  }
}

// Note: service allows to search by uuid but not email. Prefer fetching list (cached) and do in memory lookup to fit all use cases.
export async function fetchAccounts(): Promise<RegisteredAccount[]> {
  assert(MAIL_SERVICE_BASE_URL, 'set MAIL_SERVICE_BASE_URL env var');
  assert(MAIL_SERVICE_API_KEY, 'set MAIL_SERVICE_API_KEY env var');

  const apiUrl = `${MAIL_SERVICE_BASE_URL}/betas/17942/testers?api_key=${MAIL_SERVICE_API_KEY}`;

  try {
    const { data: registeredAccounts } = await mailServiceClient.get<
      RawRegisteredAccount[]
    >(apiUrl);

    return registeredAccounts.map(sanitizeAccount);
  } catch (e) {
    logger.error(e);
    throw e;
  }
}
