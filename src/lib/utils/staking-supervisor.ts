import axios from 'axios';
import { assert } from 'ts-essentials';
import { GasRefundV3EpochFlip } from '../gas-refund/gas-refund';

export type MinParaBoostData = {
  account: string;
  score: string;
  stakesScore: string;
  sePSP1UnderlyingPSPBalance: string;
  sePSP2UnderlyingPSPBalance: string;
  claimableSePSP1Balance: string;
  paraBoostFactor: string;
};

export async function fetchAccountsScores(
  epoch: number,
): Promise<MinParaBoostData[]> {  

  // v2
  const { data } = await axios.get<MinParaBoostData[]>(
    `https://api.paraswap.io/stk/paraboost/list?epoch=${epoch}`,
  );
  assert(
    data.length > 0,
    'logic error: unlikely that no paraboost was recorded',
  );
  return data;
}



export type MinParaBoostData_V3 = {
  account: string;
  score: string;
  stakesScore: string;
  seXYZUnderlyingXYZBalance: string;  
  paraBoostFactor: string;
};

export async function fetchAccountsScores_V3(
  epochv2: number,
): Promise<MinParaBoostData_V3[]> {
  // v3
  if(epochv2 >= GasRefundV3EpochFlip-31){
    const { data } = await axios.get<MinParaBoostData_V3[]>(
      // `https://api.paraswap.io/stk/paraboost/v3/list?epoch=${epochv2}`,

      // TODO: remove this "-1" thing. Purpose of it  was - test prev distribution. For that should have been stakers in the past epoch + did transactions in the past epoch, so gotta adjust here
      `http://localhost:3237/paraboost/v3/list?epoch=${epochv2 +1 }`
    );
    // because there's now only pooling boost and it now gets reset due to migration, it is now likely...
    // assert(
    //   data.length > 0,
    //   'logic error: unlikely that no paraboost was recorded',
    // );
    return data;
  }

  throw new Error('fetchAccountsScores_V3 should not be called for v2 epoch');

}
