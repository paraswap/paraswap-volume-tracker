import * as pMemoize from 'p-memoize';
import {
  loadLastEthereumDistributionFromDb,
  getLatestEpochRefundedAllChains,
} from '../../persistance/db-persistance';
import { TimeSeriesItem } from '../../timeseries';
import { getEpochStartCalcTime } from '../../../../src/lib/gas-refund/epoch-helpers';
import { assert } from 'ts-essentials';

// details about this fix: https://www.notion.so/Volume-tracker-taking-too-long-to-index-967c2469d913439dbc953266c99da6c8

const LAST_EPOCH_DISTRIBUTED_ON_FANTOM = 35;
const EPOCH_WHEN_FIX_WAS_APPLIED = 42;

// the fix alters ClaimableSePSP1 logic on initing state in a different way for computation script and for indexing script, so need a reliable way to distinguish
const IS_COMPUTATION_SCRIPT = process.argv
  .join('')
  .includes('computeDistribution');
assert(
  IS_COMPUTATION_SCRIPT === !!process.env.DISTRIBUTED_EPOCH,
  'DISTRIBUTED_EPOCH must be provided for computation script and must not be provided for indexing script',
);

async function _loadEpochToStartFrom(): Promise<{
  epochToStartFrom?: number;
  filterSePSP1ClaimTimeseriesOnInit: (item: TimeSeriesItem) => boolean;
}> {
  const [
    lastEthereumDistribution,
    // the value that used to be the "starting from" epoch in legacy code. It stuck at # 35 (epoch 5 in the new epoch numbering)  - the last distribution on Fantom
    legacyLastDistributionPreMultichain,
  ] = await Promise.all([
    loadLastEthereumDistributionFromDb(),
    getLatestEpochRefundedAllChains(),
  ]);

  const fixIsApplied =
    lastEthereumDistribution &&
    lastEthereumDistribution >= EPOCH_WHEN_FIX_WAS_APPLIED - 1;

  if (!lastEthereumDistribution || !fixIsApplied) {
    // old (pre-fix) epochs driven by legacy logic
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

  // if last saved distribution is AFTER the fix was applied - no need to be in the compatibility mode, do count all claims
  const isProcessingLegacyEpoch =
    lastEthereumDistribution <= EPOCH_WHEN_FIX_WAS_APPLIED;

  // after-fix epochs
  return {
    epochToStartFrom: lastEthereumDistribution + 1, // start from the currently indexed epoch (i.e. next one after the last indexed one)

    // this filter is intended to replicate legacy behaviour for past pre-fix epochs
    filterSePSP1ClaimTimeseriesOnInit: isProcessingLegacyEpoch
      ? item => {
          // if it's root computation script - suppress claims before the epoch of the fix
          if (IS_COMPUTATION_SCRIPT)
            return EPOCH_WHEN_FIX_WAS_APPLIED_MS <= item.timestamp;

          // if it's indexing routine - only count claims between last distribution on fantom and the epoch of the fix
          const shouldCount =
            LAST_EPOCH_DISTRIBUTED_ON_FANTOM_MS <= item.timestamp &&
            item.timestamp <= EPOCH_WHEN_FIX_WAS_APPLIED_MS;

          return shouldCount;
        }
      : // no need to skip any claims for after-fix epochs
        () => true,
  };
}
export const loadEpochToStartFromWithFix = pMemoize(_loadEpochToStartFrom, {
  cacheKey: () => `loadEpochToStartFrom`,
});
