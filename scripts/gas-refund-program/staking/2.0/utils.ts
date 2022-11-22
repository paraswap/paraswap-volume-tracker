import { sePSPMigrations } from '../../../../src/models/sePSPMigrations';

export const MIGRATION_SEPSP2_100_PERCENT_KEY =
  'MIGRATION_SEPSP2_100_PERCENT_KEY'; // trick

export const fetchMigrationsTxHashesSet = async () => {
  const allMigrations = await sePSPMigrations.findAll();

  const txHashes = new Set(allMigrations.map(m => m.txHash.toLowerCase()));

  return txHashes;
};
