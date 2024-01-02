import '../setup';
import { assert } from 'ts-essentials';
import { isTruthy } from '../../../src/lib/utils';
import database from '../../../src/database';
import { computeDistributionMerkleData } from './lib/computeDistributionMerkleData';
import { storeDistributionDataInDB } from './lib/storeDistributionDataInDB';

async function main() {
  await database.connectAndSync();

  const epoch = parseInt(process.env.DISTRIBUTED_EPOCH || '-1', 10);
  if (epoch < 0)
    throw new Error(`wrong epoch index for distribution epoch=${epoch}`);

  const merkleData = await computeDistributionMerkleData(epoch);

  await Promise.all(
    merkleData
      .map(async merkleDataForChain => {
        const { merkleTree } = merkleDataForChain;
        const chainId = +merkleDataForChain.chainId;

        assert(
          merkleTree,
          `LOGIC ERROR: could not compute merkleTree for chainId=${chainId}`,
        );
        await storeDistributionDataInDB(+chainId, merkleTree);
        return null;
      })
      .filter(isTruthy),
  );
}

main().catch(e => {
  console.error(e);
});
