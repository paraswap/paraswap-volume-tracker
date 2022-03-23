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
import { Claimable, HistoricalPrice, TxFeesByAddress } from './types';

const logger = global.LOGGER('GRP');

const epochNum = 7; // @TODO: read from EpochInfo
const epochStartTime = 1646668203; // @TODO: read from EpochInfo
const epochEndTime = 1646674203; // @TODO: read from EpochInfo

const GRP_SUPPORTED_CHAINS = [
  CHAIN_ID_MAINNET,
  //CHAIN_ID_POLYGON,
  //CHAIN_ID_BINANCE,
  //CHAIN_ID_FANTOM,
];

async function fetchDailyPSPChainCurrencyAllChains({
  startTimestamp,
  endTimestamp,
}: {
  endTimestamp: number;
  startTimestamp: number;
}) {
  const pspNativeCurrencyDailyRateByChain = Object.fromEntries(
    await Promise.all(
      GRP_SUPPORTED_CHAINS.map(chainId =>
        fetchDailyPSPChainCurrencyRate({
          chainId,
          startTimestamp,
          endTimestamp,
        }).then(p => [chainId, p] as const),
      ),
    ),
  );

  return pspNativeCurrencyDailyRateByChain;
}

async function computeAccumulatedTxFeesByAddressAllChains({
  pspNativeCurrencyDailyRateByChain,
  startTimestamp,
  endTimestamp,
}: {
  endTimestamp: number;
  startTimestamp: number;
  pspNativeCurrencyDailyRateByChain: {
    [chainId: number]: HistoricalPrice;
  };
}) {
  const dailyTxFeesByAddressByChain = Object.fromEntries(
    await Promise.all(
      GRP_SUPPORTED_CHAINS.map(chainId =>
        computeAccumulatedTxFeesByAddress({
          chainId,
          startTimestamp,
          endTimestamp,
          pspNativeCurrencyDailyRate:
            pspNativeCurrencyDailyRateByChain[chainId],
        }).then(p => [chainId, p] as const),
      ),
    ),
  );

  return dailyTxFeesByAddressByChain;
}

function reduceGasRefundByAddressAllChains(
  accTxFeesByAddressByChain: {
    [chainId: number]: TxFeesByAddress;
  },
  pspStakesByAddress: { [address: string]: bigint },
) {
  const gasRefundByAddressByChain = Object.fromEntries(
    GRP_SUPPORTED_CHAINS.map(chainId => [
      chainId,
      reduceGasRefundByAddress(
        accTxFeesByAddressByChain[chainId],
        pspStakesByAddress,
      ),
    ]),
  );

  return gasRefundByAddressByChain;
}

async function computeMerkleTreeDataAllChains(
  claimableAmountsByChain: {
    [chainId: number]: Claimable[];
  },
  epochNum: number,
) {
  const merkleTreeDataByChain = Object.fromEntries(
    await Promise.all(
      GRP_SUPPORTED_CHAINS.map(chainId =>
        computeMerkleData(claimableAmountsByChain[chainId], epochNum).then(
          p => [chainId, p] as const,
        ),
      ),
    ),
  );

  return merkleTreeDataByChain;
}

// @FIXME: we should invert the logic to first fetch stakers and then scan through their transactions as: len(stakers) << len(swappers)
// @FIXME: should cap amount distributed to stakers to 30k
export async function start() {
  // retrieve daily psp/native currency rate for (epochStartTime, epochEndTime
  logger.info('start fetching daily psp/native currency rate');
  const pspNativeCurrencyDailyRateByChain =
    await fetchDailyPSPChainCurrencyAllChains({
      startTimestamp: epochStartTime,
      endTimestamp: epochEndTime,
    });

  // retrieve all tx beetween (start_epoch_timestamp, end_epoch_timestamp) +  compute progressively mapping(chainId => address => mapping(timestamp => accGasUsedPSP)) // address: txOrigin, timestamp: start of the day
  logger.info('start computing accumulated tx fees');

  const accTxFeesByAddressByChain =
    await computeAccumulatedTxFeesByAddressAllChains({
      pspNativeCurrencyDailyRateByChain,
      startTimestamp: epochStartTime,
      endTimestamp: epochEndTime,
    });

  // retrieve mapping(address => totalStakes) where address is in dailyTxFeesByAddressByChain
  logger.info(`start fetching psp stakes`);
  const pspStakesByAddress = await fetchPSPStakes(accTxFeesByAddressByChain);

  // combine data to form mapping(chainId => address => {totalStakes@debug, gasRefundPercent@debug, accGasUsedPSP@debug, refundAmount})  // amount = accGasUsedPSP * gasRefundPercent
  logger.info(`reduce gas refund by address for all chains`);
  const gasRefundByAddressByChain = reduceGasRefundByAddressAllChains(
    accTxFeesByAddressByChain,
    pspStakesByAddress,
  );

  // compute mapping(networkId => MerkleTree)
  logger.info(`compute merkleTree by chain`);
  const merkleTreeByChain = computeMerkleTreeDataAllChains(
    gasRefundByAddressByChain,
    epochNum,
  );

  // @TODO: store merkleTreeByChain in db (or file to start with) with epochNum
  console.log({ merkleTreeByChain: JSON.stringify(merkleTreeByChain) });
}

start();
