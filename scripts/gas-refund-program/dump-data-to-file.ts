import '../../src/lib/log4js';
import * as dotenv from 'dotenv';
dotenv.config();
import Database from '../../src/database';
import { GasRefundTransaction } from '../../src/models/GasRefundTransaction';
import * as fs from 'fs';
import * as path from 'path';
import { assert } from 'ts-essentials';
import { GasRefundGenesisEpoch } from '../../src/lib/gas-refund/gas-refund';

const epoch = parseInt(process.env.EPOCH || '0', 10);
const namespace = process.env.NAMESPACE || 'local';

const columns = [
  'address',
  'chainId',
  'epoch',
  'hash',
  'status',
  'contract',

  'totalStakeAmountPSP',
  'paraBoostFactor',

  'gasUsed',

  'gasUsedUSD',
  'pspUsd',
  'chainCurrencyUsd',

  'pspChainCurrency',
  'gasUsedChainCurrency',

  'refundedAmountUSD',
  'refundedAmountPSP',
];

const filePath = path.join(
  __dirname,
  `${namespace}_epoch_${epoch}_data_${Date.now()}.csv`,
);

async function dumpEpochData() {
  assert(epoch >= GasRefundGenesisEpoch, 'logic error');
  await Database.connectAndSync();

  let offset = 0;
  const pageSize = 1000;

  fs.writeFileSync(filePath, columns.join(';'));

  while (true) {
    // scan transactions in batch sorted by timestamp and hash to guarantee stability
    const transactionsSlice = await GasRefundTransaction.findAll({
      where: {
        epoch,
      },
      order: ['timestamp', 'hash'],
      limit: pageSize,
      offset,
      raw: true,
      attributes: columns,
    });

    if (!transactionsSlice.length) {
      break;
    }

    const serialisedTxs = transactionsSlice
      .map(t => Object.values(t).join(';'))
      .join('\n');

    fs.appendFileSync(filePath, '\n' + serialisedTxs);

    offset += pageSize;
  }
}

dumpEpochData().catch(e => {
  console.error(e);
});
