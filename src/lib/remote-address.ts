import { Request } from 'express';

export const CLOUDFRONT_VIEWER_ADDRESS_REQUEST_HEADER =
  'CloudFront-Viewer-Address';

export function getRemoteAddress(req: Request) {
  return (
    req.get(CLOUDFRONT_VIEWER_ADDRESS_REQUEST_HEADER) ||
    req.headers['x-forwarded-for'] ||
    req.ip ||
    (req.connection && req.connection.remoteAddress) ||
    ''
  );
}
