import '../../lib/log4js';
import * as dotenv from 'dotenv';
dotenv.config();
import {
  CHAIN_ID_BINANCE,
  CHAIN_ID_FANTOM,
  CHAIN_ID_MAINNET,
  CHAIN_ID_POLYGON,
} from '../../lib/constants';
import { getSPSPStakes } from '../transaction-fees-indexer/staking/spsp-stakes';
import { BlockInfo } from '../../lib/block-info';
import { assert } from 'ts-essentials';
import { getSwapsForAccounts } from './getSwaps';

const logger = global.LOGGER('GRP');

const epochNum = 7; // @TODO: read from EpochInfo
const epochStartTime = 1646654400; // @TODO: read from EpochInfo
const epochEndTime = 1647864000; // @TODO: read from EpochInfo

const GRP_SUPPORTED_CHAINS = [
  CHAIN_ID_MAINNET,
  //CHAIN_ID_POLYGON,
  //CHAIN_ID_BINANCE,
  //CHAIN_ID_FANTOM,
];

async function start() {
  const chainId = CHAIN_ID_MAINNET;

  const blockInfo = BlockInfo.getInstance(chainId);
  const [startBlock, endBlock] = await Promise.all([
    blockInfo.getBlockAfterTimeStamp(epochStartTime),
    // @TODO this may beed to be BlockBeforeTimestamp, to get last block of epoch
    // or maybe first block of next epoch is better
    blockInfo.getBlockAfterTimeStamp(epochEndTime),
  ]);

  logger.info('startBlock', startBlock, 'endBlock', endBlock);

  assert(startBlock, 'we need startBlock');
  assert(endBlock, 'we need endBlock');

  // @TODO stakers at which block do we really need?
  // const poolsAndStakers = await getSPSPStakes(
  //   CHAIN_ID_MAINNET,
  //   endBlock.toString(10),
  // );

  // logger.info(
  //   'poolsAndStakers',
  //   poolsAndStakers.length,
  //   'pool',
  //   poolsAndStakers[0].pool,
  //   poolsAndStakers[0].stakers.slice(0, 2),
  // );

  // const allStakers = Array.from(
  //   new Set(
  //     poolsAndStakers.flatMap(({ stakers }) => stakers.map(st => st.staker)),
  //   ),
  // );

  // logger.info('all stakers', allStakers.length, allStakers.slice(0, 2));

  // const stakerSwaps = await getSwapsForAccounts({
  //   startBlock,
  //   endBlock,
  //   chainId,
  //   accounts: allStakers,
  // });

  // logger.info('staker swaps', stakerSwaps.length, stakerSwaps.slice(0, 2));

  // @TODO get {staker => refund %} mapping
  // @TODO get PSP pricing daily
  // @TODO match PSP price to swap for that day for account, compose {staker => gasSpent in USD (or PSP at that tiome at that price)}
  // from refund % and gasSpent and calc refundPSP
}

start();
