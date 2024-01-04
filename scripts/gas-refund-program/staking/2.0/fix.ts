import * as pMemoize from 'p-memoize';
import {
  loadLastEthereumDistributionFromDb,
  getLatestEpochRefundedAllChains,
} from '../../persistance/db-persistance';
import { TimeSeriesItem } from '../../timeseries';
import { getEpochStartCalcTime } from '../../../../src/lib/gas-refund/epoch-helpers';

// details about this fix: https://www.notion.so/Volume-tracker-taking-too-long-to-index-967c2469d913439dbc953266c99da6c8

const LAST_EPOCH_DISTRIBUTED_ON_FANTOM = 35;
const EPOCH_WHEN_FIX_WAS_APPLIED = 42;

const forceWithFix: boolean = true;

async function _loadEpochToStartFrom(): Promise<{
  epochToStartFrom?: number;
  filterSePSP1ClaimTimeseriesOnInit: (item: TimeSeriesItem) => boolean;
}> {
  const [
    // refers to multichain staking, when we started distributing GRP on ethereum and optimism only as well
    lastEthereumDistribution,
    // the value that used to be the "starting from" was 35 (epoch 5 in the new epoch numbering)
    // as it was the latest epoch distributed on Fantom
    legacyLastDistributionPreMultichain,
  ] = await Promise.all([
    loadLastEthereumDistributionFromDb(),
    getLatestEpochRefundedAllChains(),
  ]);

  const fixIsApplied =
    lastEthereumDistribution &&
    lastEthereumDistribution >= EPOCH_WHEN_FIX_WAS_APPLIED - 1;

  if (forceWithFix === false || !lastEthereumDistribution || !fixIsApplied) {
    return {
      epochToStartFrom: legacyLastDistributionPreMultichain,
      filterSePSP1ClaimTimeseriesOnInit: () => false, // ignore claims on init state, just like it used to misbehave before the fix
    };
  }
  const LAST_EPOCH_DISTRIBUTED_ON_FANTOM_MS = await getEpochStartCalcTime(
    LAST_EPOCH_DISTRIBUTED_ON_FANTOM,
  );

  const EPOCH_WHEN_FIX_WAS_APPLIED_MS = await getEpochStartCalcTime(
    EPOCH_WHEN_FIX_WAS_APPLIED,
  );

  if (!lastEthereumDistribution)
    throw new Error('lastEthereumDistribution is undefined');

  // the fix is applied
  return {
    epochToStartFrom: lastEthereumDistribution + 1, // start from the currently indexed epoch (i.e. next one after the last indexed one)
    filterSePSP1ClaimTimeseriesOnInit: item => {
      if (process.env.IS_COMPUTATION)
        return EPOCH_WHEN_FIX_WAS_APPLIED_MS <= item.timestamp;
      return item.timestamp >= LAST_EPOCH_DISTRIBUTED_ON_FANTOM_MS;
    },
  };
}
export const loadEpochToStartFromWithFix = pMemoize(_loadEpochToStartFrom, {
  cacheKey: () => `loadEpochToStartFrom`,
});
