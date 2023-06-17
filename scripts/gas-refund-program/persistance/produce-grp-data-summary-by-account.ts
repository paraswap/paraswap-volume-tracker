import '../../../src/lib/log4js';
import * as dotenv from 'dotenv';
dotenv.config();
import Database from '../../../src/database';
import * as path from 'path';
import { assert } from 'ts-essentials';
import { GasRefundGenesisEpoch } from '../../../src/lib/gas-refund/gas-refund';
import { GasRefundV2EpochFlip } from '../../../src/lib/gas-refund/gas-refund';
import { writeFile } from 'fs/promises';

const epoch = parseInt(process.env.EPOCH || '0', 10);

const filePath = path.join(
  __dirname,
  `grp-epoch1-${epoch}-epoch2-${
    epoch - GasRefundV2EpochFlip + 1
  }-summary-address-account-chain.csv`,
);

async function produceGrpDataSummaryByAccount() {
  assert(epoch >= GasRefundGenesisEpoch, 'logic error');
  await Database.connectAndSync();

  const query = `
    select
      address
      ,"chainId"
      ,sum("refundedAmountPSP") as "totalPSPRefundedForChain"
      ,sum("refundedAmountUSD") as "totalUSDRefundedForChain"
      ,round(min("totalStakeAmountPSP" * "paraBoostFactor"/10^18)) as "minScoreDuringEpoch"
      ,round(max("totalStakeAmountPSP" * "paraBoostFactor"/10^18)) as "maxScoreDuringEpoch"
      ,round(avg("totalStakeAmountPSP" * "paraBoostFactor"/10^18)) as "avgScoreDuringEpoch"
      ,count(*) as "totalTxRefunded"
    from (select * from public."GasRefundTransactions" where "refundedAmountPSP" <> 0 ) as grpTxsWithoutZeros
    where epoch=${epoch} and status='validated'
    group by address , "chainId" 
    order by 1 desc, 2 asc
  `;

  const [rawData] = (await Database.sequelize.query(query)) as [any, any];
  const header = Object.keys(rawData[0]).join(';');
  const rows = rawData.map((v: any) => Object.values(v).join(';')).join('\n');
  await writeFile(filePath, header + '\n' + rows);
}

produceGrpDataSummaryByAccount().catch(e => {
  console.error(e);
});
