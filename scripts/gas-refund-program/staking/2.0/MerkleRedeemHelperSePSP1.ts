import { constructHttpClient } from "../../../../src/lib/utils/http-client";
import { MerkleTreeData } from "../../types";

const merkleTreeDataUrlByEpoch1: Record<number, string> = {
  // since epoch 32 we started distributing refund in sePSP1 on mainnet
  32: 'https://gateway.pinata.cloud/ipfs/QmfJzuZp5rU9KedFAJ6zUfst91axqqgCAw28zjmsmk8GFX?_gl=1*118tlu9*_ga*YmFhNzhiNjgtZmFlZS00YzQ2LWIyMGEtODhmM2E2MTU2NDMx*_ga_5RMPXG14TE*MTY4MDAyNzA2Ni4xLjEuMTY4MDAyNzM5NS40Mi4wLjA'
}

const httpClient = constructHttpClient({
  axiosConfig: {
    timeout: 5_000,
  },
  rateLimitOptions: {
    maxRPS: undefined, // to override default maxRPS
  },
});


export class MerkleRedeemHelperSePSP1 {
  private static instance: MerkleRedeemHelperSePSP1;
  private cache: Record<number, MerkleTreeData>

  static getInstance() {
    if (!MerkleRedeemHelperSePSP1.instance) {
      MerkleRedeemHelperSePSP1.instance = new MerkleRedeemHelperSePSP1();
    }
    return MerkleRedeemHelperSePSP1.instance;
  }

  async getMerkleDataByEpoch(): Promise<Record<number, MerkleTreeData>> {
    if (!this.cache) {
      const promises = Object.keys(merkleTreeDataUrlByEpoch1).map(Number).map(async epoch => ({
        epoch,
        data: (await httpClient.get<MerkleTreeData>(merkleTreeDataUrlByEpoch1[epoch])).data
      }));

      const datas = await Promise.all(promises);

      this.cache = datas.reduce(
        (acc, { epoch, data }) => ({ ...acc, [epoch]: data }), {} as Record<number, MerkleTreeData>
      );
    }
    return this.cache;
  }

}
