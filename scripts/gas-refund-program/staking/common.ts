import BigNumber from 'bignumber.js';
import { VIRTUAL_LOCKUP_PERIOD } from '../../../src/lib/gas-refund';
import { TimeSeries, timeseriesComparator } from '../timeseries';

export function computeMinStakedBalanceDuringVirtualLockup(
  timestamp: number,
  stakeAtStartOfVirtualLockup: BigNumber,
  differentialStates: TimeSeries | undefined,
) {
  const startOfVirtualLockupPeriod = timestamp - VIRTUAL_LOCKUP_PERIOD;

  if (!differentialStates || differentialStates.length === 0)
    return stakeAtStartOfVirtualLockup;

  differentialStates.sort(timeseriesComparator);

  let stake = stakeAtStartOfVirtualLockup;
  let minStakeHeldDuringVirtualLockup = stakeAtStartOfVirtualLockup;

  for (let i = 0; i < differentialStates.length; i++) {
    const diffStateAtT = differentialStates[i];
    if (diffStateAtT.timestamp <= startOfVirtualLockupPeriod) continue;
    if (diffStateAtT.timestamp > timestamp) break;

    stake = stake.plus(diffStateAtT.value);

    minStakeHeldDuringVirtualLockup = BigNumber.min(
      stake,
      minStakeHeldDuringVirtualLockup,
    );
  }

  return minStakeHeldDuringVirtualLockup;
}
