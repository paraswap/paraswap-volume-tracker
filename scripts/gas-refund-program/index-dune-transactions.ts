import * as dotenv from 'dotenv';
dotenv.config();
import '../../src/lib/log4js';
import { sliceCalls } from '../../src/lib/utils/helpers';
import Database from '../../src/database';
import { DuneRow, DuneTransaction } from '../../src/models/DuneTransaction';

import * as fs from 'fs';

const tmpDirname = './dune-split-data-temp';

// returns tempFolder
function readStdinAndSliceIntoTempFolder() {
  var stdinBuffer = fs.readFileSync(0); // STDIN_FILENO = 0

  const data = JSON.parse(stdinBuffer.toString());

  console.log('data', data);

  // this is from-browser GQL response
  //const origRows = data.data.get_execution.execution_succeeded.data;

  const origRows = data.result.rows;

  fs.mkdirSync(tmpDirname, { recursive: true });

  sliceCalls({
    inputArray: origRows,
    execute: (_rows, sliceIdx) => {
      require('fs').writeFileSync(
        `${tmpDirname}/slice-${sliceIdx.toString().padStart(3, '0')}.json`,
        JSON.stringify(_rows, null, 2),
      );
    },
    sliceLength: 10000,
  });

  // this is from-browser GQL response
  // const columns = data.data.get_execution.execution_succeeded.columns;
  const columns = data.result.metadata.column_names;
  require('fs').writeFileSync(
    `${tmpDirname}/_columns.json`,
    JSON.stringify(columns, null, 2),
  );
}

function cleanupTempFolder() {
  fs.rmSync(tmpDirname, { recursive: true, force: true });
}

async function loadSlicesIntoDb() {
  const files = fs
    .readdirSync(tmpDirname)
    .filter(file => !!file.match(/slice-\d+.json/));

  await Database.connectAndSync('transform-dune-response');
  await DuneTransaction.destroy({ truncate: true });

  for (let i = 0; i < files.length; i++) {
    const filename = files[i];
    const origRows: DuneRow[] = JSON.parse(
      fs.readFileSync(`${tmpDirname}/${filename}`).toString(),
    );

    const rows: Partial<DuneRow>[] = origRows.map(row => ({
      ...Object.fromEntries(
        Object.entries(row).map(([key, value]) => [
          key,
          value === 'n/a' ? null : value,
        ]),
      ),
      block_timestamp: row.block_time
        ? Date.parse(row.block_time) / 1000
        : undefined, // looks like 2023-08-31 22:14:05.000 UTC
    }));

    const queries = sliceCalls({
      inputArray: rows,
      execute: async (_rows, sliceIdx) => {
        try {
          await DuneTransaction.bulkCreate(_rows);
        } catch (e) {
          // error in bulk? try one by one and find out which row is faulty
          try {
            await Promise.all(
              _rows.map(async row => {
                try {
                  const res = await DuneTransaction.bulkCreate([row]);
                } catch (e) {
                  // to debug in individual level if smth goes wrong
                  console.error('failed to insert individual', e);

                  throw e;
                }
              }),
            );
          } catch (e) {
            throw e;
          }
          throw e;
        }
        console.log(`inserted slice ${sliceIdx}. Rows length:`, _rows.length);
      },
      sliceLength: 1000,
    });
  }
}

async function main() {
  readStdinAndSliceIntoTempFolder();

  await loadSlicesIntoDb();

  cleanupTempFolder();
}

main();
