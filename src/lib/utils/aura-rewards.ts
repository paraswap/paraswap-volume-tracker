import * as pMemoize from 'p-memoize';
import {
  MinParaBoostData,
  fetchAccountsScores,
  fetchTotalScore,
} from './staking-supervisor';
import BigNumber from 'bignumber.js';
import { GasRefundV2EpochFlip } from '../gas-refund/gas-refund';
import { CHAIN_ID_OPTIMISM } from '../constants';
import { getCurrentEpoch } from '../gas-refund/epoch-helpers';

const config: Record<number, string> = {
  // @TODO: update this config
  39: '1234567890123123123',
};

const AURA_REWARDS_START_EPOCH_OLD_STYLE = Math.min(...Object.keys(config).map(Number));

const logger = global.LOGGER('aura-rewards');

async function _fetchEpochData(epoch: number) {
  const [totalScore, list] = await Promise.all([
    fetchTotalScore(epoch),
    fetchAccountsScores(epoch),
  ]);

  const byAccountLowercase = list.reduce<Record<string, MinParaBoostData>>(
    (acc, curr) => {
      acc[curr.account.toLowerCase()] = curr;
      return acc;
    },
    {},
  );

  logger.info(`loaded pre-requisites for computing Aura rewards for epoch ${epoch}`)

  return {
    totalScore,
    list,
    byAccountLowercase,
  };
}

// cache forever
const fetchPastEpochData = pMemoize(_fetchEpochData, {
  cacheKey: ([epoch]) => `paraboost_epochData_${epoch}`,
});

// approximate -> because there's no integrity check (sum of parts = whole), just simple pro rata calc
export async function getApproximateUserRewardWei(
  user: string,
  epochOldStyle: number,
  chainId: number
) {
  if(epochOldStyle == getCurrentEpoch()){
    // not known yet
    return "0";
  }
  if(chainId !== CHAIN_ID_OPTIMISM) return "0"
  // for epochs before Aura rewards started, return 0 
  if(epochOldStyle < AURA_REWARDS_START_EPOCH_OLD_STYLE) return "0"

  const epoch = epochOldStyle - GasRefundV2EpochFlip;
  const { byAccountLowercase, totalScore } = await fetchPastEpochData(epoch);

  const userScore = byAccountLowercase[user.toLowerCase()].score || '0';

  return new BigNumber(userScore)
    .times(config[epochOldStyle] || '0')
    .div(totalScore)
    .toFixed(0);
}
