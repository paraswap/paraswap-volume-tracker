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

import { MIGRATION_SEPSP2_100_PERCENT_KEY } from './staking/2.0/utils';
import { isTruthy } from '../../src/lib/utils';
import { CHAIN_ID_OPTIMISM } from '../../src/lib/constants';

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
      getContractAddresses({ epoch: currentEpoch, chainId }).filter(
        address => address !== MIGRATION_SEPSP2_100_PERCENT_KEY,
      ),
    ]),
  );
  return contractAddressesByChainId;
}

// @TODO: probably should use some tempating engine here
async function generateDuneQuery() {
  const currentEpoch = getCurrentEpoch();
  const { startCalcTime, endCalcTime } = await resolveEpochCalcTimeInterval(
    currentEpoch - 1,
  );
  const dateFrom = timestampToDuneFormatted(startCalcTime);
  const dateTo = timestampToDuneFormatted(endCalcTime);

  const conractsByChainId = getContractsByChainId();

  const parts = GRP_SUPPORTED_CHAINS.map(chainId => {
    const network = CHAIN_ID_TO_DUNE_NETWORK[chainId];
    const transactionsInvolvingContract = `transactionsInvolvingContract_${network}`;
    const contracts = [...conractsByChainId[chainId]].join(',');

    const txTableColumns = `
from
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

    const txTableColumnsPart =
      chainId === CHAIN_ID_OPTIMISM
        ? txTableColumns
            .map(s => `cast(transactions."${s}" as varchar) as "${s}"`)
            .join(', ')
        : txTableColumns
            .map(s =>
              s.includes('l1_')
                ? `'n/a' as "${s}"`
                : `cast(transactions."${s}" as varchar) as "${s}"`,
            )
            .join(', ');

    const networkData = `networkData_${network}`;
    const query = `     
  
     ${transactionsInvolvingContract} as (
       select         
         tx_hash,
         max(to) as contract,   
         max(block_time),
         max(block_number) as block_number   
       from
         ${network}.traces
       where
        block_time >= to_timestamp(${dateFrom}, 'yyyy-mm-dd hh24:mi:ss')
         and block_time <= to_timestamp(${dateTo}, 'yyyy-mm-dd hh24:mi:ss')         
         and to in (${contracts})
       group by
         tx_hash         
       order by
         max(block_time) desc
     ),
     ${networkData} as (
   select
     ${chainId} as chainId, ${transactionsInvolvingContract}.contract as contract, ${txTableColumnsPart}
   from
     ${transactionsInvolvingContract}
     left join ${network}.transactions as transactions on ${transactionsInvolvingContract}.block_number = transactions.block_number
     and ${transactionsInvolvingContract}.tx_hash = transactions.hash
     and transactions.block_time >= to_timestamp(${dateFrom}, 'yyyy-mm-dd hh24:mi:ss')
     and block_time <= to_timestamp(${dateTo}, 'yyyy-mm-dd hh24:mi:ss')
     where transactions.success = true     
     )`;

    return [networkData, query];
  });

  const queries = parts.map(([, query]) => `${query}`).join(',\n');

  const unionPart = parts
    .map(([networkData]) => `(select * from ${networkData})`)
    .join(' UNION \n');

  return `with ${queries} SELECT * from (\n${unionPart}) ORDER BY block_time DESC`;
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
