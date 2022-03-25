import '../../lib/log4js';
import * as dotenv from 'dotenv';
dotenv.config();
import {
  CHAIN_ID_BINANCE,
  CHAIN_ID_FANTOM,
  CHAIN_ID_MAINNET,
  CHAIN_ID_POLYGON,
} from '../../lib/constants';
import { reduceGasRefundByAddress } from './gas-refund';
import { computeMerkleData } from './merkle-tree';
import { fetchDailyPSPChainCurrencyRate } from './psp-chaincurrency-pricing';
import { computeAccumulatedTxFeesByAddress } from './transaction-fees';
import { fetchPSPStakes } from './staking';
import { saveMerkleTree } from './persistance';

const logger = global.LOGGER('GRP');

const epochNum = 8; // @TODO: read from EpochInfo
const epochStartTime = 1646654400; // @TODO: read from EpochInfo
const epochEndTime = 1647864000; // @TODO: read from EpochInfo

const GRP_SUPPORTED_CHAINS = [
  CHAIN_ID_MAINNET,
  //CHAIN_ID_POLYGON,
  //CHAIN_ID_BINANCE,
  //CHAIN_ID_FANTOM,
];

// @FIXME: we should invert the logic to first fetch stakers and then scan through their transactions as: len(stakers) << len(swappers)
// @FIXME: should cap amount distributed to stakers to 30k
export async function processTxFeesForChain(chainId: number) {
  // retrieve daily psp/native currency rate for (epochStartTime, epochEndTime
  logger.info('start fetching daily psp/native currency rate');
  const pspNativeCurrencyDailyRate = await fetchDailyPSPChainCurrencyRate({
    chainId,
    startTimestamp: epochStartTime,
    endTimestamp: epochEndTime,
  });

  // retrieve all tx beetween (start_epoch_timestamp, end_epoch_timestamp) +  compute progressively mapping(chainId => address => mapping(timestamp => accGasUsedPSP)) // address: txOrigin, timestamp: start of the day
  logger.info('start computing accumulated tx fees');

  const accTxFeesByAddress = await computeAccumulatedTxFeesByAddress({
    chainId,
    pspNativeCurrencyDailyRate,
    startTimestamp: epochStartTime,
    endTimestamp: epochEndTime,
  });

  // retrieve mapping(address => totalStakes) where address is in dailyTxFeesByAddressByChain
  logger.info(`start fetching psp stakes`);
  const swapperAddresses = [...new Set(Object.keys(accTxFeesByAddress))];

  const pspStakesByAddress = await fetchPSPStakes(swapperAddresses);

  // combine data to form mapping(chainId => address => {totalStakes@debug, gasRefundPercent@debug, accGasUsedPSP@debug, refundAmount})  // amount = accGasUsedPSP * gasRefundPercent
  logger.info(`reduce gas refund by address for all chains`);
  const gasRefundByAddress = await reduceGasRefundByAddress(
    accTxFeesByAddress,
    pspStakesByAddress,
  );

  // compute mapping(networkId => MerkleTree)
  logger.info(`compute merkleTree by chain`);
  const merkleTree = await computeMerkleData(
    chainId,
    gasRefundByAddress,
    epochNum,
  );

  // @TODO: store merkleTreeByChain in db (or file to start with) with epochNum
  await saveMerkleTree({ merkleTree, chainId, epochNum });
}

async function start() {
  await Promise.all(
    GRP_SUPPORTED_CHAINS.map(chainId => processTxFeesForChain(chainId)),
  );
}

start();
