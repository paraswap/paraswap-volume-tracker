import * as _ from 'lodash';
import { assert } from 'ts-essentials';
import { configLoader } from '../../config';
import { constructHttpClient } from '../utils/http-client';
import {
  AccountCreationError,
  AccountDeleteError,
  AccountByUUIDNotFoundError,
  DuplicatedAccountError,
} from './errors';
import {
  AccountToCreate,
  RegisteredAccount,
  AccountStatus,
  AccountGroup,
} from './types';

const logger = global.LOGGER('MailService');

const globalConfig = configLoader.getGlobalConfig();

const mailServiceClient = constructHttpClient({
  cacheOptions: {
    maxAge: 30 * 1000,
    limit: 100,
    exclude: {
      query: false, // apikey is passed through query param
    },
  },
  rateLimitOptions: {
    maxRPS: 5,
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
    'groups',
  ]);
}

// service present some latency (5min observed). Creating account then trying to retrieve it right away would likely fail.
export async function createNewAccount(
  account: AccountToCreate,
  isVerified: boolean,
): Promise<RegisteredAccount> {
  assert(globalConfig.apiPrefineryHttp, 'set MAIL_SERVICE_BASE_URL env var');
  assert(globalConfig.apiKeyPrefinery, 'set MAIL_SERVICE_API_KEY env var');

  const apiUrl = `${globalConfig.apiPrefineryHttp}/betas/17942/testers?api_key=${globalConfig.apiKeyPrefinery}`;

  const createdAccount = {
    ...account,
    ...(isVerified
      ? {
          status: AccountStatus.IMPORTED,
          groups: AccountGroup.PSP_STAKERS,
        }
      : {
          status: AccountStatus.APPLIED,
          groups: AccountGroup.WAITLIST,
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
  assert(globalConfig.apiPrefineryHttp, 'set MAIL_SERVICE_BASE_URL env var');
  assert(globalConfig.apiKeyPrefinery, 'set MAIL_SERVICE_API_KEY env var');

  const apiUrl = `${globalConfig.apiPrefineryHttp}/betas/17942/testers/${uuid}?api_key=${globalConfig.apiKeyPrefinery}`;

  try {
    await mailServiceClient.delete(apiUrl);
  } catch (e) {
    throw new AccountDeleteError({ uuid });
  }
}

export async function fetchAccountByUUID({
  uuid,
}: Pick<RegisteredAccount, 'uuid'>): Promise<RegisteredAccount> {
  assert(globalConfig.apiPrefineryHttp, 'set MAIL_SERVICE_BASE_URL env var');
  assert(globalConfig.apiKeyPrefinery, 'set MAIL_SERVICE_API_KEY env var');

  const apiUrl = `${globalConfig.apiPrefineryHttp}/betas/17942/testers/${uuid}?api_key=${globalConfig.apiKeyPrefinery}`;

  try {
    const { data: registeredAccount } =
      await mailServiceClient.get<RawRegisteredAccount>(apiUrl);

    return sanitizeAccount(registeredAccount);
  } catch (e) {
    logger.error(e);
    throw new AccountByUUIDNotFoundError({ uuid });
  }
}
