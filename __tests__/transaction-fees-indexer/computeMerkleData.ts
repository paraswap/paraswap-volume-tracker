import * as ethers from "ethers"
import { Claimable, computeMerkleData } from "../../src/service/transaction-fees-indexer/merkle-tree"
import { CHAIN_ID_MAINNET } from '../../src/lib/constants';
import { getChance } from "jest-chance"

const TEST_SEED = "test seed seed test";

const CHAIN_ID = CHAIN_ID_MAINNET;
const EPOCH = 10;

const Claim_Amounts = [2, 10, 1000] // 10_000 takes ~5min
// can run CLAIMS=80 yarn test
if (process.env.CLAIMS) {
  Claim_Amounts.push(Number.parseInt(process.env.CLAIMS))
}

describe("computeMerkleData", () => {
  const expectedMerkleTree = expect.objectContaining({
    root: expect.objectContaining({
      merkleRoot: expect.any(String),
      totalAmount: expect.any(String),
      epoch: EPOCH,
    }),
    leaves: expect.arrayContaining([expect.objectContaining({
      merkleProofs: expect.arrayContaining([expect.any(String)]),
      address: expect.any(String),
      amount: expect.any(String),
      epoch: EPOCH,
    })])
  })

  test.each(Claim_Amounts)("%i Claims", async (nClaims) => {
    const { genWallets, genClaimable } = makeGenerators(nClaims)
    const wallets = genWallets(nClaims);

    const claimableAmmounts: Claimable[] = wallets.map(w => genClaimable(w.address));

    const merkleTree = await computeMerkleData(CHAIN_ID, claimableAmmounts, EPOCH);

    expect(merkleTree).toBeTruthy();
    // match shape
    expect(merkleTree).toMatchObject(expectedMerkleTree);
    // match snapshot, both addresses and amounts are deterministic, so snapshots match
    expect(merkleTree).toMatchSnapshot(`merkleTree for ${nClaims}`) // nClaims allows to easier match between snapshots
  })
})

function makeGenerators(randomPart: string | number = "") {
  // to have reliable seed depending on amount of wallets
  // otherwise if use the same seed for 10 then 100 wallets
  // and later disabling test for 10 wallets
  // different wallets will be generated
  const seed = TEST_SEED + randomPart;

  const chance = getChance(seed)

  const genWallet = (): ethers.Wallet => {
    const PK = "0x" + chance.string({ length: 42, pool: "0123456789abcdef" })
    return new ethers.Wallet(PK);
  }

  const genWallets = (n: number): ethers.Wallet[] => {
    return Array.from({ length: n }, genWallet);
  }

  const genClaimable = (address: string): Claimable => {
    const amount = chance.integer({ min: 1e8, max: 2e18 }).toString(10)

    return { address, amount };
  }

  return { genWallet, genWallets, genClaimable }
}