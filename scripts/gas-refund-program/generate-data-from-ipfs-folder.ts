import * as dotenv from 'dotenv';
dotenv.config();
import { assert } from 'ts-essentials';
import '../../src/lib/log4js';
import axios from 'axios';

const IPFS_FOLDER_CID = process.env.IPFS_FOLDER_CID; // bafybeiglb2l7lludg6n4lroojycfcz26r6cehrxfkhzpbiauetit4ij2rm
const IPFS_DOMAIN = process.env.IPFS_DOMAIN; // copper-total-fly-652.mypinata.cloud
const EPOCH = process.env.EPOCH;

assert(IPFS_DOMAIN, 'IPFS_DOMAIN not found in the env');
assert(EPOCH, 'EPOCH not found in the env');
assert(IPFS_FOLDER_CID, 'IPFS_FOLDER_CID not found in the env');

async function loadIPFSFolder(cid: string) {
  const chainId = 1;
  const url = `https://${IPFS_DOMAIN}/ipfs/${IPFS_FOLDER_CID}/merkle-data-chain-${chainId}-epoch-${EPOCH}.json`;
  const { data } = await axios.get(url);

  console.log('IPFS folder data:', data);
}

loadIPFSFolder(IPFS_FOLDER_CID).catch(error => {
  console.error('Error loading IPFS folder:', error);
});
