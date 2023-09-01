import * as dotenv from 'dotenv';
dotenv.config();

import '../src/lib/log4js';
import * as fs from 'fs';
import Database from '../src/database';
import { Claim } from '../src/models/Claim';

const logger = global.LOGGER();

async function main() {
  logger.info('Loading airdrop JSON file...');
  const data = JSON.parse(
    fs.readFileSync('scripts/airdrop.json', { encoding: 'utf8' }),
  );

  logger.info('Connecting to DB...');
  await Database.connectAndSync();

  logger.info('Deleting any pre-existing data...');
  await Claim.destroy({ truncate: true });

  const claims = Object.entries(data.claims).map(
    ([userAddress, claim]: [string, object]) => ({ userAddress, claim }),
  );
  logger.info(`Storing ${claims.length} records...`);
  await Claim.bulkCreate(claims, { returning: false, logging: false });

  logger.info(`Successfully stored ${claims.length} records!`);
}

main()
  .then(function () {
    process.exit();
  })
  .catch(function (e) {
    console.error(e);
    process.exit(1);
  });
