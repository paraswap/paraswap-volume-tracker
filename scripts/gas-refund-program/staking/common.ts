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

  const minStakeHeldDuringVirtualLockup = differentialStates.reduce(
    (minStake, stakeAtT) => {
      if (
        stakeAtT.timestamp < startOfVirtualLockupPeriod ||
        stakeAtT.timestamp > timestamp
      ) {
        return minStake;
      }

      const newStake = minStake.plus(stakeAtT.value);
      const _minStake = BigNumber.min(minStake, newStake);

      return _minStake;
    },
    stakeAtStartOfVirtualLockup,
  );

  return minStakeHeldDuringVirtualLockup;
}
