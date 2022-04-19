import { Lock } from '../models/Lock';

export async function acquireLock(key: string) {
  await Lock.create({
    key,
  });
}

export async function releaseLock(key: string) {
  await Lock.destroy({
    where: {
      key,
    },
  });
}
