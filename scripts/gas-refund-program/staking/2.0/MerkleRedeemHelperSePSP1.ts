import * as pMemoize from 'p-memoize';
import { constructHttpClient } from '../../../../src/lib/utils/http-client';
// this should match to `type FileMerkleTreeData`
export type MerkleRoot = {
  merkleRoot: string;
  totalAmount: string;
  epoch: number;
};
export type MerkleData = {
  proof: string[];
  address: string;
  amount: string;
  epoch: number;
};

export type MerkleTreeData = {
  root: MerkleRoot;
  merkleProofs: MerkleData[];
};

// @TODO: create separate repo just for this config?
const TREE_DATA_URL_BY_EPOCH_URL =
  'https://raw.githubusercontent.com/paraswap/paraswap-volume-tracker/master/scripts/gas-refund-program/distributions.json';
const TREE_DATA_URL_BY_EPOCH_CACHE_MAX_AGE_MS = 60 * 5 * 1000; // 5 minutes
type UrlByEpoch = {
  [epoch: number]: {
    [chainId: number]: string;
  };
};
const httpClientWithTempCache = constructHttpClient({
  cacheOptions: {
    // debug: console.log, // will refetch on `cache-miss` and `cache-stale`
    maxAge: TREE_DATA_URL_BY_EPOCH_CACHE_MAX_AGE_MS,
  },
});
const fetchTreeDataUrlByLegacyEpoch = async (): Promise<UrlByEpoch> =>
  (await httpClientWithTempCache.get<UrlByEpoch>(TREE_DATA_URL_BY_EPOCH_URL))
    .data;

const _fetchEpochData = async (url: string): Promise<MerkleTreeData> =>
  (await httpClientWithTempCache.get<MerkleTreeData>(url)).data;

// stored on ipfs and is immutable, so can cache forever
const fetchEpochData = pMemoize(_fetchEpochData, {
  cacheKey: ([url]) => `epochData_${url}`,
});

export type MerkleTreeDataByEpoch = Record<number, MerkleTreeData>;
export class MerkleRedeemHelperSePSP1 {
  private static instances: { [chainId: number]: MerkleRedeemHelperSePSP1 }  = {};

  private chainId: number;

  constructor(chainId: number) {
    this.chainId = chainId;
  }

  private cacheData?: {
    cacheKey: string;
    merkleDataByEpoch: MerkleTreeDataByEpoch;
  };

  static getInstance(chainId: number) {
    if (!MerkleRedeemHelperSePSP1.instances[chainId]) {
      MerkleRedeemHelperSePSP1.instances[chainId] =
        new MerkleRedeemHelperSePSP1(chainId);
    }
    return MerkleRedeemHelperSePSP1.instances[chainId];
  }

  async getMerkleDataByEpochWithCacheKey(): Promise<{
    merkleDataByEpoch: MerkleTreeDataByEpoch;
    cacheKey: string;
  }> {
    const merkleTreeDataUrlByLegacyEpoch =
      await fetchTreeDataUrlByLegacyEpoch();
    const newCacheKey = JSON.stringify(merkleTreeDataUrlByLegacyEpoch);

    if (!this.cacheData || this.cacheData.cacheKey !== newCacheKey) {
      const promises = Object.keys(merkleTreeDataUrlByLegacyEpoch)
        .map(Number)
        .filter(epoch => merkleTreeDataUrlByLegacyEpoch[epoch][this.chainId])
        .map(async epoch => ({
          epoch,
          data: await fetchEpochData(
            merkleTreeDataUrlByLegacyEpoch[epoch][this.chainId],
          ),
        }));

      const datas = await Promise.all(promises);

      const merkleDataByEpoch = datas.reduce<MerkleTreeDataByEpoch>(
        (acc, { epoch, data }) => ({ ...acc, [epoch]: data }),
        {},
      );

      this.cacheData = {
        merkleDataByEpoch,
        cacheKey: JSON.stringify(merkleTreeDataUrlByLegacyEpoch),
      };
    }
    return this.cacheData;
  }
}
