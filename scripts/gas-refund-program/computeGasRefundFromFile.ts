import * as dotenv from 'dotenv';
dotenv.config();

import '../../src/lib/log4js';
import Database from '../../src/database';
import StakesTracker, { isStakeScoreV2 } from './staking/stakes-tracker';
import { validateTransactions } from './transactions-validation/validateTransactions';
import { fetchRefundableTransactionsAllChains } from './transactions-indexing/fetchRefundableTransactionsAllChains';
import {
  getEpochStartCalcTime,
  loadEpochMetaData,
} from '../../src/lib/gas-refund/epoch-helpers';
import * as fs from 'fs';

import * as csv from 'csv-parser';
import { parse } from 'json2csv';

import { add, chain, max, times } from 'lodash';
import { assert } from 'ts-essentials';
import { fetchParaBoostPerAccount } from './transactions-validation/paraBoost';
import {
  GasRefundTransactionData,
  getRefundPercent,
  TransactionStatus,
} from '../../src/lib/gas-refund/gas-refund';
import { GasRefundTransactionDataWithStakeScore } from './transactions-indexing/types';
import { storeTxs } from './transactions-indexing/fetchRefundableTransactions';
import BigNumber from 'bignumber.js';

const loadCSVAsAssociativeArray = (
  filePath: string,
): Promise<Record<string, string>[]> => {
  return new Promise((resolve, reject) => {
    const results: Record<string, string>[] = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', data => results.push(data))
      .on('end', () => resolve(results))
      .on('error', error => reject(error));
  });
};

const logger = global.LOGGER('GRP');

const GRP_EPOCH_31_START_DATE = new Date('2023-01-23T12:00:00Z');
const EPOCH_DURATION_MS = 4 * 7 * 24 * 60 * 60 * 1000; // 4 weeks in milliseconds

const calculateEpoch = (date: Date): number => {
  const diff = date.getTime() - GRP_EPOCH_31_START_DATE.getTime();
  return Math.floor(diff / EPOCH_DURATION_MS) + 31;
};
function isMigrationTx() {}

const EPOCH = process.env.EPOCH ? parseInt(process.env.EPOCH) : 0;
if (!EPOCH) {
  throw new Error('EPOCH is not set');
}
async function startComputingGasRefundAllChains() {
  await Database.connectAndSync('gas-refund-computation');
  loadEpochMetaData();

  await Database.sequelize.transaction(async () => {
    const csvData = await loadCSVAsAssociativeArray(
      `./0${EPOCH - 31}-${EPOCH}-sorted.csv`,
    );
    const parsed = csvData.map(row => {
      return {
        psp_token_usd_price: row.psp_token_usd_price,
        full_gas_fee_in_psp: row.full_gas_fee_in_psp,
        source: row.source,
        chain_id: parseInt(row.chain_id),
        call_block_time: new Date(row.call_block_time),
        gas_fee_usd: row.gas_fee_usd,
        from: row.from,
        contract: row.contract,
        hash: row.hash,
        call_block_number: parseInt(row.call_block_number),
      };
    });

    const callBlockTimes = parsed.map(row => row.call_block_time);
    const minCallBlockTime = new Date(
      Math.min(...callBlockTimes.map(date => date.getTime())),
    );
    const maxCallBlockTime = new Date(
      Math.max(...callBlockTimes.map(date => date.getTime())),
    );

    const minEpoch = calculateEpoch(minCallBlockTime);
    const maxEpoch = calculateEpoch(maxCallBlockTime);

    if (minEpoch !== maxEpoch)
      throw new Error(
        `Epochs are not the same: max=${maxEpoch}, min=${minEpoch}`,
      );

    const epoch = minEpoch;

    await StakesTracker.getInstance().loadHistoricalStakes(epoch);
    const endTimestamp = await getEpochStartCalcTime(epoch + 1);

    const usdRefundedByUser: Record<string, number> = {};
    const paraboosts = await fetchParaBoostPerAccount(epoch);

    const withScores = parsed
      // .slice(0, 1)
      .map(csvRow => {
        // debugger;
        const stakeScore = StakesTracker.getInstance().computeStakeScore(
          csvRow.from,
          csvRow.call_block_time.getTime() / 1000,
          epoch,
          endTimestamp,
        );

        assert(isStakeScoreV2(stakeScore), 'byNetwork not in stakeScore');

        const user_paraboost = paraboosts[csvRow.from.toLowerCase()] || 1;
        const is_still_staker_eoe = !!user_paraboost;

        const totalUserScore = stakeScore.combined
          .times(user_paraboost)
          .toFixed(0);

        const gas_refund_percent = getRefundPercent(epoch, totalUserScore);

        const usdRefunded =
          parseFloat(csvRow.gas_fee_usd) * (gas_refund_percent || 0);

        usdRefundedByUser[csvRow.from] =
          (usdRefundedByUser[csvRow.from] || 0) + usdRefunded;

        const is_over_limit = usdRefundedByUser[csvRow.from] > 500;

        const extendedCsvRow = {
          ...csvRow,
          paraboost_factor_end_of_epoch: user_paraboost,
          total_score: totalUserScore,
          gas_refund_percent: gas_refund_percent,

          psp_refunded_wei: new BigNumber(csvRow.full_gas_fee_in_psp)
            .multipliedBy(gas_refund_percent || 0)
            .multipliedBy(1e18)
            .toFixed(0),
          stake_score_combined: stakeScore.combined.toFixed(),
          stake_chain_1_stake_score: stakeScore.byNetwork[1]?.stakeScore,
          stake_chain_1_stake_sepsp1_balance:
            stakeScore.byNetwork[1]?.sePSP1Balance,
          stake_chain_1_stake_sepsp2_balance:
            stakeScore.byNetwork[1]?.sePSP2Balance,
          stake_chain_1_stake_bpt_total_supply:
            stakeScore.byNetwork[1]?.bptTotalSupply,
          stake_chain_1_stake_bpt_psp_balance:
            stakeScore.byNetwork[1]?.bptPSPBalance,
          stake_chain_1_stake_claimable_sepsp1_balance:
            stakeScore.byNetwork[1]?.claimableSePSP1Balance,

          stake_chain_10_stake_score: stakeScore.byNetwork[10]?.stakeScore,
          stake_chain_10_stake_sepsp1_balance:
            stakeScore.byNetwork[10]?.sePSP1Balance,
          stake_chain_10_stake_sepsp2_balance:
            stakeScore.byNetwork[10]?.sePSP2Balance,
          stake_chain_10_stake_bpt_total_supply:
            stakeScore.byNetwork[10]?.bptTotalSupply,
          stake_chain_10_stake_bpt_psp_balance:
            stakeScore.byNetwork[10]?.bptPSPBalance,
          stake_chain_10_stake_claimable_sepsp1_balance:
            stakeScore.byNetwork[10]?.claimableSePSP1Balance,
          usd_user_refunded_cumulative: usdRefundedByUser[csvRow.from],
          is_over_limit,
          is_still_staker_eoe,
        };

        //   epoch: number;
        // address: string;
        // chainId: number;
        // hash: string;
        // block: number;
        // timestamp: number;
        // gasUsed: string;
        // gasUsedChainCurrency: string;
        // gasPrice: string;
        // gasUsedUSD: string;
        // pspUsd: number;
        // chainCurrencyUsd: number;
        // pspChainCurrency: number;
        // totalStakeAmountPSP: string;
        // refundedAmountPSP: string;
        // refundedAmountUSD: string;
        // contract: string;
        // status: TransactionStatus;
        // paraBoostFactor: number;

        const gasRefundTransactionModelData: GasRefundTransactionData = {
          epoch,
          address: csvRow.from.toLowerCase(),
          chainId: csvRow.chain_id,
          hash: csvRow.hash,
          block: csvRow.call_block_number, //TODO
          timestamp: csvRow.call_block_time.getTime() / 1000,
          gasUsed: '0', //TODO // - don't bother prop drilling this data, as it's inherently wrong -> need to include l1 fee in data structure
          gasUsedChainCurrency: '0', //TODO -- same as above
          gasPrice: '0', //TODO -- same as above
          gasUsedUSD: csvRow.gas_fee_usd,
          pspUsd: parseFloat(csvRow.psp_token_usd_price),
          chainCurrencyUsd: 0, //TODO - same as above
          pspChainCurrency: 0, //TODO -- same as aboe -- data is dervied from USD and full psp price at time of tx...
          totalStakeAmountPSP: totalUserScore,
          refundedAmountPSP: extendedCsvRow.psp_refunded_wei,
          refundedAmountUSD: `${usdRefunded}`,
          contract: csvRow.contract,
          status: is_over_limit
            ? TransactionStatus.REJECTED
            : TransactionStatus.VALIDATED,
          paraBoostFactor: user_paraboost,
        };

        const gasRefundTransactionModelDataWithStakeScore: GasRefundTransactionDataWithStakeScore =
          {
            stakeScore,
            ...gasRefundTransactionModelData,
          };
        const row = {
          extendedCsvRow,

          gasRefundTransactionModelDataWithStakeScore,
        };
        // debugger;
        return row;
      });

    // console.log(withScores);`
    // await fetchRefundableTransactionsAllChains();
    await Database.sequelize.query(`

      
    

delete from "GasRefundTransactionStakeSnapshots";
-- where  "transactionHash" in (
  --    select "hash" from "GasRefundTransactions" where "epoch" = ${EPOCH}
    --  );
    
      delete from "GasRefundTransactions" where "epoch" = ${EPOCH};
  
      `);

    const txsWithScores = withScores
      .map(item => item.gasRefundTransactionModelDataWithStakeScore)
      .filter(item => parseFloat(item.refundedAmountUSD) > 0);

    await storeTxs({
      txsWithScores,
      logger,
    });

    // await validateTransactions();
    saveAsCSV(
      withScores.map(item => item.extendedCsvRow),
      `./0${EPOCH - 31}-${EPOCH}-sorted-with-scores.csv`,
    );
  });
}

const saveAsCSV = (data: any[], filePath: string) => {
  try {
    const csv = parse(data);
    fs.writeFileSync(filePath, csv);
    console.log(`Data saved to ${filePath}`);
  } catch (err) {
    console.error('Error saving data as CSV:', err);
  }
};

startComputingGasRefundAllChains()
  .then(() => {
    process.exit(0);
  })
  .catch(err => {
    debugger;
    logger.error(
      'startComputingGasRefundAllChains exited with error:',
      err,
      err.response?.data,
      err.request?.path,
    );
    process.exit(1);
  });
