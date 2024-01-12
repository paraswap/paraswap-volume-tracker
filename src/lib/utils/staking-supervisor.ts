import axios from 'axios';
import { assert } from 'ts-essentials';

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
  const { data } = await axios.get<MinParaBoostData[]>(
    `https://api.paraswap.io/stk/paraboost/list?epoch=${epoch}`,
  );
  assert(
    data.length > 0,
    'logic error: unlikely that no paraboost was recorded',
  );
  return data;
}
