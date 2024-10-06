import * as dotenv from 'dotenv';
dotenv.config();
import '../../src/lib/log4js';

import {
  getCurrentEpoch,
  resolveEpochCalcTimeInterval,
} from '../../src/lib/gas-refund/epoch-helpers';
import { GRP_SUPPORTED_CHAINS } from '../../src/lib/gas-refund/gas-refund';
import { getContractAddresses } from './transactions-indexing/transaction-resolver';
import * as moment from 'moment';
import * as fs from 'fs';

import { MIGRATION_SEPSP2_100_PERCENT_KEY } from './staking/2.0/utils';
import { isTruthy } from '../../src/lib/utils';
import { CHAIN_ID_OPTIMISM } from '../../src/lib/constants';
import { grp2ConfigByChain } from '../../src/lib/gas-refund/config';

const loadStakersFromFile = (filePath: string): string[] => {
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  return fileContent.split('\n').filter(line => line.trim() !== '');
};

export const CHAIN_ID_TO_DUNE_NETWORK: Record<number, string> = {
  1: 'ethereum',
  56: 'bnb',
  137: 'polygon',
  250: 'fantom',
  10: 'optimism',
  42161: 'arbitrum',
  43114: 'avalanche-c',
};

export function timestampToDuneFormatted(timestamp: number) {
  return `'${moment.unix(timestamp).utc().format('YYYY-MM-DD HH:mm:ss')}'`;
}

function getContractsByChainId() {
  const currentEpoch = getCurrentEpoch();
  const contractAddressesByChainId = Object.fromEntries(
    GRP_SUPPORTED_CHAINS.map(chainId => [
      chainId,
      // skip migration of sPSP to social escrow 2.0 - 6 epochs when it was eligible passed long ago
      getContractAddresses({ epoch: currentEpoch, chainId }).filter(
        address => address !== MIGRATION_SEPSP2_100_PERCENT_KEY,
      ),
    ]),
  );
  return contractAddressesByChainId;
}

// @TODO: probably should use some tempating engine here
async function generateDuneQuery() {
  const targetEpoch = 52;
  // const currentEpoch = getCurrentEpoch();
  const { startCalcTime, endCalcTime } = await resolveEpochCalcTimeInterval(
    targetEpoch,
  );
  const dateFrom = timestampToDuneFormatted(startCalcTime);
  const dateTo = timestampToDuneFormatted(endCalcTime);

  const conractsByChainId = getContractsByChainId();

  const parts = GRP_SUPPORTED_CHAINS.map(chainId => {
    const network = CHAIN_ID_TO_DUNE_NETWORK[chainId];
    const transactionsInvolvingContractsAlias = `transactionsInvolvingContracts_${network}`;
    const contracts = [...conractsByChainId[chainId]].join(',');

    const txTableColumns = `
"from"
gas_price
hash
to
block_number
block_time
gas_used
l1_fee
success
`
      .split(/\n/)
      .map(s => s.trim())
      .filter(isTruthy);

    const skip_from_casting_to_varchar = new Set([
      'block_time',
      'l1_fee',
      '"from"',
      'hash',
    ]);
    const txTableColumnsPart =
      chainId === CHAIN_ID_OPTIMISM
        ? txTableColumns
            .map(s =>
              skip_from_casting_to_varchar.has(s)
                ? s
                : `cast(transactions."${s}" as varchar) as "${s}"`,
            )
            .join(', ')
        : txTableColumns
            .map(s =>
              s.includes('l1_')
                ? `0 as "${s}"`
                : skip_from_casting_to_varchar.has(s)
                ? s
                : `cast(transactions."${s}" as varchar) as "${s}"`,
            )
            .join(', ');

    const query = `     
  
     ${transactionsInvolvingContractsAlias} as (
       select     
        ${chainId} as chainId,         
         to as contract,            
         ${txTableColumnsPart}
       from
         ${network}.transactions
       where
        block_time >= to_timestamp(${dateFrom}, 'yyyy-mm-dd hh24:mi:ss')
         and block_time <= to_timestamp(${dateTo}, 'yyyy-mm-dd hh24:mi:ss')         
         and to in (${contracts})
         and "from" in (select staker from hardcoded_stakers)       
         and transactions.success = true
     )`;

    return [transactionsInvolvingContractsAlias, query];
  });

  const queries = parts.map(([, query]) => `${query}`).join(',\n');

  const unionPart = parts
    .map(([networkData]) => `(select * from ${networkData})`)
    .join(' UNION \n');

  //   WITH hardcoded_stakers AS (
  //     SELECT staker
  //     FROM UNNEST(ARRAY[
  //     0xfffff9b1c2c387b1e3d19af292d91d913374f42b,
  //     0xffffd230115df924d3b805624437f4e47281c3f8
  //     ]) AS t(staker)
  // )
  // const stakers = loadStakersFromFile('all_stakers_by_epoch_20.csv');
  const stakers: string[] = [];
  return `
  
  
  
  with hardcoded_stakers AS (
      SELECT staker
      FROM UNNEST(ARRAY[
      ${stakers.join(',')}
      ]) AS t(staker)
  ),
  ${queries} SELECT * from (\n${unionPart}) ORDER BY block_time DESC
  
  `;
}

async function main() {
  const query = await generateDuneQuery();
  console.log('________________________________________________');
  console.log(
    "-- This is a generated query. Don't modify it manually, as it'll get overwritten by script",
  );
  console.log(query);
  console.log('________________________________________________');
  console.log('Use the above output here https://dune.com/queries');
}

main()
  .then(res => {
    console.log('script finished', res);
    process.exit(0);
  })
  .catch(error => {
    console.error('script failed', error);
    process.exit(1);
  });
