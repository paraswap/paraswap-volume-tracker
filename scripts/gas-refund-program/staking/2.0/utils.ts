import { sePSPMigrations } from '../../../../src/models/sePSPMigrations';
import { Contract, EventFilter } from 'ethers';

export const MIGRATION_SEPSP2_100_PERCENT_KEY =
  'MIGRATION_SEPSP2_100_PERCENT_KEY'; // trick

export const fetchMigrationsTxHashesSet = async () => {
  const allMigrations = await sePSPMigrations.findAll({
    raw: true,
    attributes: ['txHash'],
  });

  const txHashes = new Set(allMigrations.map(m => m.txHash.toLowerCase()));

  return txHashes;
};

interface QueryFilterOptions {
  batchSize: number;
}
export async function queryFilterBatched(
  contract: Contract,
  eventFilter: EventFilter,
  startBlock: number,
  endBlock: number,
  options: QueryFilterOptions = { batchSize: 10000 },
) {
  const { batchSize } = options;
  let iteratorStart = startBlock;
  const queryRequests = [];

  while (iteratorStart < endBlock) {
    const intervalEnd = Math.min(iteratorStart + batchSize, endBlock);
    queryRequests.push(
      contract.queryFilter(eventFilter, iteratorStart, intervalEnd),
    );
    iteratorStart = intervalEnd + 1;
  }

  const results = await Promise.all(queryRequests);

  return results.flat();
}
