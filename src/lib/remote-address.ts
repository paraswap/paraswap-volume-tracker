import { NextFunction, Request, Response } from 'express';
import { getAsyncContextValue, setAsyncContextValue } from './async-context';

export const CLOUDFRONT_VIEWER_ADDRESS_REQUEST_HEADER =
  'CloudFront-Viewer-Address';

const logger = global.LOGGER('RemoteAddress');

function extractRemoteAddress(req: Request) {
  const cldViewerAddr = req.get(CLOUDFRONT_VIEWER_ADDRESS_REQUEST_HEADER);
  const xfwrdFor = req.headers['x-forwarded-for'];
  const ip = req.ip || null;
  const remoteAddress =
    (req.connection && req.connection.remoteAddress) || null;

  logger.info(
    `IPS=${JSON.stringify({ cldViewerAddr, xfwrdFor, ip, remoteAddress })}`,
  );

  return cldViewerAddr || xfwrdFor || ip || remoteAddress;
}

export const REMOTE_ADDRESS_ASYNC_CONTEXT_KEY = 'rAdd';

export default function RemoteAddressMiddleware() {
  return function remoteAddressMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    setAsyncContextValue(
      REMOTE_ADDRESS_ASYNC_CONTEXT_KEY,
      extractRemoteAddress(req),
    );
    return next();
  };
}

export function getRemoteAddress() {
  return getAsyncContextValue(REMOTE_ADDRESS_ASYNC_CONTEXT_KEY) || '';
}
