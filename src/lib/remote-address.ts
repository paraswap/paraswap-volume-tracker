import { NextFunction, Request, Response } from 'express';
import { getAsyncContextValue, setAsyncContextValue } from './async-context';

export const CLOUDFRONT_VIEWER_ADDRESS_REQUEST_HEADER =
  'CloudFront-Viewer-Address';

function extractRemoteAddress(req: Request) {
  return (
    req.get(CLOUDFRONT_VIEWER_ADDRESS_REQUEST_HEADER) ||
    req.headers['x-forwarded-for'] ||
    req.ip ||
    (req.connection && req.connection.remoteAddress)
  );
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
