import { UniqueConstraintError } from 'sequelize';
import { wait } from 'ts-retry-promise';
import { Lock } from '../models/Lock';

const DEFAULT_TIMEOUT = 10 * 1000;
const DEFAULT_POOL_INTERVAL = 500;

type Options = {
  timeout: number;
  targetPollInterval: number;
};
const DefaultOptions = {
  timeout: DEFAULT_TIMEOUT,
  targetPollInterval: DEFAULT_POOL_INTERVAL,
};

export class LockTimeoutError extends Error {
  constructor(message?: string) {
    const name = 'LockTimeoutError';
    super(name + ' ' + (message || '').trim());
    this.name = name;
  }
}

export async function acquireLock(key: string, options?: Options) {
  const { timeout, targetPollInterval } = { ...DefaultOptions, ...options };

  const pollInterval = Math.min(targetPollInterval, timeout);
  const startedDate = Date.now();

  while (true) {
    try {
      await Lock.create({
        key,
      });
      return;
    } catch (e) {
      if (Date.now() > startedDate + timeout) {
        throw new LockTimeoutError();
      }

      if (e instanceof UniqueConstraintError) {
        await wait(pollInterval);
        continue;
      }

      throw e;
    }
  }
}

export async function releaseLock(key: string) {
  await Lock.destroy({
    where: {
      key,
    },
  });
}
