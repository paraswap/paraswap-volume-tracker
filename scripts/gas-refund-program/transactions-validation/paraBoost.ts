import axios from 'axios';
import { assert } from 'ts-essentials';
import { GasRefundV2EpochFlip } from '../../../src/lib/gas-refund/gas-refund';

export type ParaBoostPerAccount = { [account: string]: number };
type MinParaBoostData = {
  account: string;
  paraBoostFactor: string;
};

async function fetchParaBoostPerAccount(epoch1: number) {
  const epoch2 = epoch1 - GasRefundV2EpochFlip;

  assert(epoch2 >= 0, 'epoch2 can never be negative');

  const { data } = await axios.get<MinParaBoostData[]>(
    `https://api.paraswap.io/stk/paraboost/list?epoch=${epoch2}`,
  );
  assert(
    data.length > 0,
    'logic error: unlikely that no paraboost was recorded',
  );

  const paraBoostFactorByAccount = data.reduce<ParaBoostPerAccount>(
    (acc, paraBoostData) => {
      const paraBoostFactor = parseFloat(paraBoostData.paraBoostFactor);
      assert(
        paraBoostFactor >= 1,
        'paraBoostFacotr should always be greater or equal than 1',
      );
      acc[paraBoostData.account.toLowerCase()] = paraBoostFactor;
      return acc;
    },
    {},
  );

  return paraBoostFactorByAccount;
}

export const constructFetchParaBoostPerAccountMem = () => {
  let memEpoch1: number;
  let memData: ParaBoostPerAccount;

  return async (epoch1: number) => {
    if (epoch1 === memEpoch1) {
      assert(memData, 'paraBoost data should be defined here');
      return memData;
    }
    memData = await fetchParaBoostPerAccount(epoch1);
    memEpoch1 = epoch1;
    return memData;
  };
};
