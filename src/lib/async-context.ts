import { NextFunction, Request, Response } from 'express';
import { AsyncLocalStorage } from 'async_hooks';

type AsyncContext = Map<string, any>;

const asyncLocalStorage = new AsyncLocalStorage<AsyncContext>();

export default function AsyncContextMiddleware() {
  return function asyncContextdMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    asyncLocalStorage.run(new Map(), async () => {
      return next();
    });
  };
}

export function getAsyncContextStore() {
  return asyncLocalStorage.getStore();
}

export function getAsyncContextValue(key: string) {
  return asyncLocalStorage.getStore()?.get(key);
}

export function setAsyncContextValue(key: string, value: any) {
  return asyncLocalStorage.getStore()?.set(key, value);
}
