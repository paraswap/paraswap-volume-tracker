import { assert } from 'ts-essentials';
import { getTransaction } from '../../../../src/lib/utils/covalent';
import {
  sePSPMigrations,
  SePSPMigrationsData,
} from '../../../../src/models/sePSPMigrations';
import { GasRefundTransaction } from '../../types';

import ERC20StateTracker, { Transfer } from './ERC20StateTracker';
import { GRP_V2_SUPPORTED_CHAINS_STAKING } from '../../../../src/lib/gas-refund/gas-refund';
import { MIGRATION_SEPSP2_100_PERCENT_KEY } from './utils';
import {
  forceStakingChainId,
  grp2ConfigByChain,
  grp2GlobalConfig,
} from '../../../../src/lib/gas-refund/config';

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

type GetMigrationsTXsInput = {
  epoch: number;
  chainId: number;
  startTimestamp: number;
  endTimestamp: number;
};

export async function getMigrationsTxs({
  epoch,
  chainId: _chaindId,
  startTimestamp,
  endTimestamp,
}: GetMigrationsTXsInput): Promise<GasRefundTransaction[]> {
  if (!GRP_V2_SUPPORTED_CHAINS_STAKING.has(_chaindId)) return [];
  if (epoch > grp2GlobalConfig.lastEpochForSePSP2MigrationRefund) return []; // 100% refund is only valid first two epochs

  const chainId = forceStakingChainId(_chaindId);

  const { sePSP2, migrator } = grp2ConfigByChain[chainId];
  assert(sePSP2, 'sePSP2 should be defined');
  assert(migrator, 'migrator should be defined');

  const sePSP2Tracker = ERC20StateTracker.getInstance(chainId, sePSP2); // TODO: add check to verify that singleton got loaded
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
  // TODO avoid overfetching
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
        contract: MIGRATION_SEPSP2_100_PERCENT_KEY,
      };
    }),
  );

  return migrationsTxs.filter(
    t => +t.timestamp >= startTimestamp && +t.timestamp <= endTimestamp,
  );
}
