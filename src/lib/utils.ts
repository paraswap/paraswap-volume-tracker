import axios, { AxiosBasicCredentials, AxiosResponse } from 'axios';
import { Request } from 'express';
import * as https from 'https';
import { getRemoteAddress } from './remote-address';

const HTTP_TIMEOUT = 500;

axios.defaults.httpsAgent = new https.Agent({ keepAlive: true });

export class Utils {
  public static readonly isAWS =
    process.env.ECS_CONTAINER_METADATA_URI !== undefined;

  static getIP = (req: Request): string => {
    const address = getRemoteAddress(req);

    return Array.isArray(address)
      ? address[0]
      : address?.split(':')[0] || address;
  };

  static _get<T = any>(
    url: string,
    timeout?: number,
    headers: { [key: string]: string | number } = {},
    auth?: AxiosBasicCredentials,
  ) {
    return Utils._axios<T>(url, 'get', null, timeout, headers, auth);
  }

  static _post<T = any>(
    url: string,
    data?: any,
    timeout?: number,
    headers: { [key: string]: string | number } = {},
    auth?: AxiosBasicCredentials,
  ) {
    return Utils._axios<T>(url, 'post', data, timeout, headers, auth);
  }

  static _axios<T = any>(
    url: string,
    method: 'get' | 'post',
    data?: any,
    timeout: number = HTTP_TIMEOUT,
    headers: { [key: string]: string | number } = {},
    auth?: AxiosBasicCredentials,
  ): Promise<AxiosResponse<T>> {
    return axios({
      method,
      url,
      data,
      timeout,
      headers: {
        'User-Agent': 'node.js',
        ...headers,
      },
      auth,
    });
  }
}

export const sortTokens = (tokenA: string, tokenB: string): [string, string] =>
  [tokenA.toLowerCase(), tokenB.toLowerCase()].sort((a, b) =>
    a > b ? 1 : -1,
  ) as [string, string];
