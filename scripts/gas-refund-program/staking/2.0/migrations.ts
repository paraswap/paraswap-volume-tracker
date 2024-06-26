import { assert } from 'ts-essentials';
import { getTransaction } from '../../../../src/lib/utils/covalent';
import {
  sePSPMigrations,
  SePSPMigrationsData,
} from '../../../../src/models/sePSPMigrations';

import ERC20StateTracker, { Transfer } from './ERC20StateTracker';
import { GRP_V2_SUPPORTED_CHAINS_STAKING } from '../../../../src/lib/gas-refund/gas-refund';
import { MIGRATION_SEPSP2_100_PERCENT_KEY } from './utils';
import {
  forceStakingChainId,
  grp2ConfigByChain,
  grp2GlobalConfig,
} from '../../../../src/lib/gas-refund/config';
import { CHAIN_ID_MAINNET } from '../../../../src/lib/constants';
import { ExtendedCovalentGasRefundTransaction } from '../../../../src/types-from-scripts';

const transform = (
  events: Transfer[],
  chainId: number,
  epoch: number,
): SePSPMigrationsData[] =>
  events.map(event => ({
    account: event.args.to.toLowerCase(),
    chainId,
    epoch: +event.blockNumber < 16669614 ? 31 : 32, // simple patch to allow recompute old data safely
    txHash: event.transactionHash,
    blockNumber: event.blockNumber,
    txTimestamp: event.blockNumber, // bug but not important for logic
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
}: GetMigrationsTXsInput): Promise<ExtendedCovalentGasRefundTransaction[]> {
  if (!GRP_V2_SUPPORTED_CHAINS_STAKING.has(_chaindId)) return [];
  if (epoch > grp2GlobalConfig.lastEpochForSePSP2MigrationRefund) return []; // 100% refund is only valid first two epochs

  const chainId = forceStakingChainId(_chaindId);

  const { sePSP2, psp1ToPsp2Migrator } = grp2ConfigByChain[chainId];

  if (chainId !== CHAIN_ID_MAINNET && !psp1ToPsp2Migrator) {
    return [];
  }

  assert(sePSP2, 'sePSP2 should be defined');
  assert(psp1ToPsp2Migrator, 'migrator should be defined');

  const sePSP2Tracker = ERC20StateTracker.getInstance(chainId, sePSP2); // TODO: add check to verify that singleton got loaded
  const { transferEvents } = sePSP2Tracker;
  const migrationsEvents = transferEvents.filter(
    e => e.args.from.toLowerCase() === psp1ToPsp2Migrator.toLowerCase(),
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

  const migrationsTxs: ExtendedCovalentGasRefundTransaction[] =
    await Promise.all(
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
