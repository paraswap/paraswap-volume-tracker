import { assert } from 'ts-essentials';
import { CHAIN_ID_MAINNET } from '../../../../src/lib/constants';
import { getTransaction } from '../../../../src/lib/utils/covalent';
import {
  sePSPMigrations,
  SePSPMigrationsData,
} from '../../../../src/models/sePSPMigrations';
import { GasRefundTransaction } from '../../types';
import { config } from './config';
import ERC20StateTracker, { Transfer } from './ERC20StateTracker';

const chainId = CHAIN_ID_MAINNET;

export const MIGRATION_SEPSP2_100_PERCENT_KEY =
  'MIGRATION_SEPSP2_100_PERCENT_KEY'; // trick

const transform = (
  events: Transfer[],
  chainId: number,
  epoch: number,
): SePSPMigrationsData[] =>
  events.map(event => ({
    account: event.args.to.toLowerCase(),
    chainId,
    epoch,
    txHash: event.transactionHash,
    blockNumber: event.blockNumber,
    txTimestamp: event.blockNumber,
  }));

// FIXME handle collision between refund 100% one time and casual tx refunding
export async function getMigrationsTxs({
  epoch,
  startTimestamp,
  endTimestamp,
}: {
  epoch: number;
  startTimestamp: number;
  endTimestamp: number;
}): Promise<GasRefundTransaction[]> {
  const { sePSP2, migrator } = config[chainId];
  assert(sePSP2, 'sePSP2 should be defined');
  assert(migrator, 'migrator should be defined');

  const sePSP2Tracker = ERC20StateTracker.getInstance(chainId, sePSP2);
  const { transferEvents } = sePSP2Tracker;
  const migrationsEvents = transferEvents.filter(
    e => e.args.from.toLowerCase() === migrator.toLowerCase(),
  );
  const migrations = transform(migrationsEvents, chainId, epoch);

  // should only push new migrations txs that never got registered before
  await sePSPMigrations.bulkCreate(migrations, {
    ignoreDuplicates: true, // only one migration matters
  });

  // should only get migrations txs of the epoch
  // FIXME avoid overfetching
  const allMigrationsEpoch = await sePSPMigrations.findAll({
    where: {
      epoch,
    },
  });

  const migrationsTxs: GasRefundTransaction[] = await Promise.all(
    allMigrationsEpoch.map(async v => {
      const { account, chainId, blockNumber, txHash } = v;

      const tx = await getTransaction({
        chainId,
        txHash,
      });

      const txTimestamp = Math.floor(
        new Date(tx.block_signed_at).getTime() / 1000,
      ).toString();

      assert(
        blockNumber === tx.block_height,
        'block numbers for tx should match',
      );

      return {
        txHash,
        txOrigin: account,
        txGasPrice: tx.gas_price.toString(), // legacy - verify unit
        blockNumber: blockNumber.toString(), // legacy
        timestamp: txTimestamp,
        txGasUsed: tx.gas_spent.toString(), // legacy
        contract: 'sePSP2 migrations', // TODO
      };
    }),
  );

  return migrationsTxs.filter(
    t => +t.timestamp >= startTimestamp && +t.timestamp <= endTimestamp,
  );
}
