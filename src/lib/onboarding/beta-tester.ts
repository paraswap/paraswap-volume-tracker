import axios from 'axios';
import * as jwt from 'jsonwebtoken';
import { assert } from 'ts-essentials';
import { configLoader } from '../../config';
import { AuthToken } from './types';

const config = configLoader.getGlobalConfig();

const logger = global.LOGGER('BetaTest');

const keyid = 'SQ994H8QHA';
const issuerId = '2e01237d-0848-46cc-a3ac-b0f6245eb42b';

export function generateAuthToken(): AuthToken {
  assert(config.apiKeyAplcapi, 'set APLCAPI_KEY env var');

  const pk = config.apiKeyAplcapi.replace(/\\n/g, '\n');

  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 15 * 60;

  const payload = {
    iss: issuerId,
    iat,
    exp,
    aud: 'appstoreconnect-v1',
  };

  const header: jwt.JwtHeader = {
    kid: keyid,
    alg: 'ES256',
    typ: 'JWT',
  };

  const token = jwt.sign(payload, pk, { header });

  return {
    token,
    exp,
  };
}

export async function createTester({
  email,
  authToken,
}: {
  email: string;
  authToken: string;
}) {
  assert(config.apiAplcapiHttp, 'set APLCAPI_BASE_URL env var');

  try {
    await axios.post(
      config.apiAplcapiHttp + '/v1/betaTesters',
      {
        data: {
          attributes: {
            email,
          },
          relationships: {
            betaGroups: {
              data: [
                {
                  id: 'be810bd7-cf31-4fe5-8835-d0cb55d4e762',
                  type: 'betaGroups',
                },
              ],
            },
          },
          type: 'betaTesters',
        },
      },

      {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      },
    );
  } catch (e) {
    logger.error(e);
    throw e;
  }
}
