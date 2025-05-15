import * as dotenv from 'dotenv';
dotenv.config();
import { assert } from 'ts-essentials';
import '../../src/lib/log4js';
import axios from 'axios';
import { GasRefundDistribution } from '../../src/models/GasRefundDistribution';
import {
  GasRefundDistributionData,
  GasRefundParticipantData,
} from '../../src/lib/gas-refund/gas-refund';
import Database from '../../src/database';
import { GasRefundParticipation } from '../../src/models/GasRefundParticipation';

const IPFS_FOLDER_CID = process.env.IPFS_FOLDER_CID; // bafybeiglb2l7lludg6n4lroojycfcz26r6cehrxfkhzpbiauetit4ij2rm
const IPFS_DOMAIN = process.env.IPFS_DOMAIN; // copper-total-fly-652.mypinata.cloud
const EPOCH = process.env.EPOCH;

assert(IPFS_DOMAIN, 'IPFS_DOMAIN not found in the env');
assert(EPOCH, 'EPOCH not found in the env');
assert(IPFS_FOLDER_CID, 'IPFS_FOLDER_CID not found in the env');

const claimChains = [1, 10];
async function loadIPFSFolder(cid: string) {
  await Database.connectAndSync('load-from-ipfs');
  assert(EPOCH, 'EPOCH not found in the env');
  for (const chainId of claimChains) {
    const url = `https://${IPFS_DOMAIN}/ipfs/${IPFS_FOLDER_CID}/merkle-data-chain-${chainId}-epoch-${EPOCH}.json`;
    console.log('url', url);
    const { data } = await axios.get(url);

    const { root, proofs: proofsByUser } = data;

    const distributionData: GasRefundDistributionData = {
      epoch: parseInt(EPOCH),
      chainId,
      totalPSPAmountToRefund: root.totalAmount,
      merkleRoot: root.merkleRoot,
    };
    await GasRefundDistribution.bulkCreate([distributionData]);

    const participations: GasRefundParticipantData[] = proofsByUser.map(
      ({
        amount,
        amountsByProgram,
        grpChainBreakdown,
        merkleProofs,
        user,
      }: any) => ({
        epoch: parseInt(EPOCH),
        chainId,
        address: user,
        amount,
        amountsByProgram,
        merkleProofs,
        GRPChainBreakDown: grpChainBreakdown,
      }),
    );

    await GasRefundParticipation.bulkCreate(participations);
  }
}

loadIPFSFolder(IPFS_FOLDER_CID).catch(error => {
  console.error('Error loading IPFS folder:', error);
});
