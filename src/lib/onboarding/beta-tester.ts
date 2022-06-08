import axios from 'axios';
import * as jwt from 'jsonwebtoken';
import { assert } from 'ts-essentials';
import { AuthToken } from './types';

const logger = global.LOGGER('BetaTest');

const _pk = process.env.APLCAPI_KEY;
const baseUrl = process.env.APLCAPI_BASE_URL;
const keyid = 'SQ994H8QHA';
const issuerId = '2e01237d-0848-46cc-a3ac-b0f6245eb42b';

export function generateAuthToken(): AuthToken {
  assert(_pk, 'set APLCAPI_KEY env var');

  const pk = _pk.replace(/\\n/g, '\n');

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

export async function submitTester({
  email,
  authToken,
}: {
  email: string;
  authToken: string;
}) {
  assert(baseUrl, 'set APLCAPI_BASE_URL env var');

  try {
    await axios.post(
      baseUrl + '/v1/betaTesters',
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
