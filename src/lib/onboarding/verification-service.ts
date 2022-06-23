import { assert } from 'ts-essentials';
import { constructHttpClient } from '../utils/http-client';

const logger = global.LOGGER('verificationService');

const responseVerificationClient = constructHttpClient({
  axiosConfig: {
    baseURL: 'https://www.google.com/recaptcha/api/siteverify',
  },
  rateLimitOptions: {
    maxRPS: 5,
  },
});

export const verifyKey = async (key: string) => {
  assert(process.env.CAPTCHA_SECRET_KEY, 'CAPTCHA_SECRET_KEY should be set');

  try {
    await responseVerificationClient.post(
      '',
      {
        secret: process.env.CAPTCHA_SECRET_KEY,
        response: key,
      },
      {
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      },
    );
  } catch (e) {
    logger.error(e);

    throw e;
  }
};
