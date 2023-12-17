import '../setup';
import { assert } from 'ts-essentials';
import database from '../../../src/database';
import { computeDistributionMerkleData } from './lib/computeDistributionMerkleData';

import { writeFile } from 'fs/promises';
import path from 'path';
import { computeDistributionSafeProposal } from './lib/computeDistributionSafeProposal';
import { mkdirp } from 'mkdirp';

import { persistDirectoryToPinata } from './utils/utils/pinata';
import { GasRefundGenesisEpoch } from '../../../src/lib/gas-refund/gas-refund';

const constructBasePath = (epoch: number) =>
  path.join(__dirname, `data/grp-distribution-epoch-${epoch}`);

const constructFilePath = (epoch: number, filePath: string) =>
  `${constructBasePath(epoch)}/${filePath}`;

const constructMerkleDataFilePath = ({
  chainId,
  epoch,
}: {
  chainId: number;
  epoch: number;
}) =>
  constructFilePath(epoch, `merkledata-chain-${chainId}-epoch-${epoch}.json`);

const constructProposalFilePath = ({
  chainId,
  epoch,
}: {
  chainId: number;
  epoch: number;
}) => constructFilePath(epoch, `proposal-chain-${chainId}-epoch-${epoch}.json`);

const constructSimulationFilePath = ({
  chainId,
  epoch,
  withBalanceChecks,
}: {
  chainId: number;
  epoch: number;
  withBalanceChecks: boolean;
}) =>
  constructFilePath(
    epoch,
    `simulation-chain-${chainId}-epoch-${epoch}${
      withBalanceChecks ? '-withbalancechecks' : ''
    }.txt`,
  );

const constructRewardsListFilePath = ({
  chainId,
  epoch,
}: {
  chainId: number;
  epoch: number;
}) => constructFilePath(epoch, `grp-chain-${chainId}-epoch-${epoch}.csv`);

async function serialiseRefundToCSV(epoch: number): Promise<string> {
  assert(epoch >= GasRefundGenesisEpoch, 'logic error');

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

  const [rawData] = (await database.sequelize.query(query)) as [any, any];
  const header = Object.keys(rawData[0]).join(';');
  const rows = rawData.map((v: any) => Object.values(v).join(';')).join('\n');

  const combinedData = header + '\n' + rows;

  return combinedData;
}

async function computeDistributionFilesAndPersistIPFS() {
  await database.connectAndSync();

  const epoch = parseInt(process.env.DISTRIBUTED_EPOCH || '-1', 10);
  if (epoch < 0)
    throw new Error(
      `LOGIC ERROR: wrong epoch index for distribution epoch=${epoch}`,
    );

  const directoryPath = constructBasePath(epoch);
  await mkdirp(directoryPath);

  const merkleDataAllChains = await computeDistributionMerkleData(epoch);

  await Promise.all(
    merkleDataAllChains.map(async merkleData => {
      const { chainId } = merkleData;
      const merkleDataFilePath = constructMerkleDataFilePath({
        chainId: +chainId,
        epoch,
      });
      const proposalFilePath = constructProposalFilePath({
        chainId: +chainId,
        epoch,
      });

      const rewardsFilePath = constructRewardsListFilePath({
        chainId: +chainId,

        epoch,
      });

      await writeFile(
        merkleDataFilePath,
        JSON.stringify(merkleData.merkleTree),
      );

      const serialisedParticipations = await serialiseRefundToCSV(epoch);

      await writeFile(rewardsFilePath, serialisedParticipations);

      const proposal = await computeDistributionSafeProposal(merkleData);
      await writeFile(proposalFilePath, JSON.stringify(proposal));

      // TODO simulation
      /*
      const simulationUrlsWithBalanceChecks =
        await computeDistributionSimulation(merkleData, proposal, true);

      await writeFile(
        constructSimulationFilePath({
          chainId: +chainId,
          epoch,
          withBalanceChecks: true,
        }),
        simulationUrlsWithBalanceChecks,
      );

      const simulationUrlsWithoutBalanceChecks =
        await computeDistributionSimulation(merkleData, proposal, false);

      await writeFile(
        constructSimulationFilePath({
          chainId: +chainId,
          epoch,
          withBalanceChecks: false,
        }),
        simulationUrlsWithoutBalanceChecks,
      );
      */
    }),
  );

  const ipfsHash = await persistDirectoryToPinata(directoryPath);

  console.log(
    `Successfully pushed all files to IPFS through pinata, ipfsHash=${ipfsHash}`,
  );

  // TODO: add step to add new entry in scripts/gas-refund-program/distributions.json
}

computeDistributionFilesAndPersistIPFS().catch(e => {
  console.error(e);
});
