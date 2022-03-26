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
import { Claimable, HistoricalPrice, TxFeesByAddress, PSPStakesByAddress, UpdateCompletedEpochData, MerkleData, MerkleTreeDataByChain } from './types';
import { EpochGasRefund } from '../../models/EpochGasRefund';
import Database from '../../database';

import BigNumber from 'bignumber.js';

const logger = global.LOGGER('GRP');

const epochNum = 7; // @TODO: read from EpochInfo
const epochStartTime = 1647877128; // @TODO: read from EpochInfo
const epochEndTime = 1647884328; // @TODO: read from EpochInfo

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
  epochNum
}: {
  endTimestamp: number;
  startTimestamp: number;
  pspNativeCurrencyDailyRateByChain: {
    [chainId: number]: HistoricalPrice;
  };
  epochNum: number
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
          epoch: epochNum
        }).then(p => [chainId, p] as const),
      ),
    ),
  );

  return dailyTxFeesByAddressByChain;
}

async function reduceGasRefundByAddressAllChains(
  accTxFeesByAddressByChain: {
    [chainId: number]: TxFeesByAddress;
  },
  pspStakesByAddress: { [address: string]: BigNumber },
) {
  const gasRefundByAddressByChain = Object.fromEntries(
    await Promise.all(
      GRP_SUPPORTED_CHAINS.map(chainId => [
        chainId,
        reduceGasRefundByAddress(
          accTxFeesByAddressByChain[chainId],
          pspStakesByAddress,
        ),
      ]),
    ),
  );

  return gasRefundByAddressByChain;
}

const writeCompletedEpochData = async (merkleTreeDataByChain: MerkleTreeDataByChain, pspStakesByAddress: PSPStakesByAddress) => {

  /*
  epoch: number                   merkleTreeDataByChain.[chainId].root.epoch
  address: string                 merkleTreeDataByChain.[chainId].leaves[].address
  chainId: string                 merkleTreeDataByChain.[chainId].leaves[].amount

  totalStakeAmountPSP: string     pspStakesByAddress[address]
  refundedAmountPSP: string       merkleTreeDataByChain.[chainId].root.totalAmount
  merkleProofs: string[]          merkleTreeDataByChain.[chainId].leaves[].merkleProofs
  merkleRoot: string              merkleTreeDataByChain.[chainId].root.merkleRoot
  */

  const epochDataToUpdate: UpdateCompletedEpochData[] = Object
  .keys(merkleTreeDataByChain)
  .map((chainId) => {
    const merkleTreeDataForChain = merkleTreeDataByChain[+chainId]
    // because `computeMerkleData` can return null
    if (!merkleTreeDataForChain) {
      return []
    }
    const { root: { epoch, totalAmount, merkleRoot }, leaves } = merkleTreeDataForChain

    const addresses = leaves.map((leaf: MerkleData) => ({
      epoch,
      address: leaf.address,
      chainId,

      totalStakeAmountPSP: pspStakesByAddress[leaf.address].toString(), // todo: make safe
      refundedAmountPSP: totalAmount,
      merkleProofs: leaf.merkleProofs,
      merkleRoot,
    }))
    return addresses
  })
  // lastly flatten the array (of chain specific arrays)
  .reduce((buildingArray, array) => buildingArray.concat(array), [])


  // todo: bulk upsert epoch data once models are defined
  for (let i = 0; i < epochDataToUpdate.length; i++) {
    const endEpochData = epochDataToUpdate[i];

    // key
    const { epoch, address, chainId } = endEpochData
    // update
    const { totalStakeAmountPSP, refundedAmountPSP, merkleProofs, merkleRoot } = endEpochData

    const row = await EpochGasRefund.findOne({ where: { epoch, address, chainId }})

    await EpochGasRefund.update(
      {
        totalStakeAmountPSP, refundedAmountPSP, merkleProofs, merkleRoot
      },
      {
        where: { epoch, address, chainId}
      }
    )
  }

}

async function computeMerkleTreeDataAllChains(
  claimableAmountsByChain: {
    [chainId: number]: Claimable[];
  },
  epochNum: number,
): Promise<MerkleTreeDataByChain> {
  const merkleTreeDataByChain = Object.fromEntries(
    await Promise.all(
      GRP_SUPPORTED_CHAINS.map(chainId =>
        computeMerkleData(
          chainId,
          claimableAmountsByChain[chainId],
          epochNum,
        ).then(p => [chainId, p] as const),
      ),
    ),
  );

  return merkleTreeDataByChain;
}

// @FIXME: we should invert the logic to first fetch stakers and then scan through their transactions as: len(stakers) << len(swappers)
// @FIXME: should cap amount distributed to stakers to 30k
export async function start(epochNum: number) {
  // todo: seed db models/relations
  await Database.connectAndSync()
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
      epochNum
    });

  // retrieve mapping(address => totalStakes) where address is in dailyTxFeesByAddressByChain
  logger.info(`start fetching psp stakes`);
  const pspStakesByAddress = await fetchPSPStakes(accTxFeesByAddressByChain);

  // combine data to form mapping(chainId => address => {totalStakes@debug, gasRefundPercent@debug, accGasUsedPSP@debug, refundAmount})  // amount = accGasUsedPSP * gasRefundPercent
  logger.info(`reduce gas refund by address for all chains`);
  const gasRefundByAddressByChain = await reduceGasRefundByAddressAllChains(
    accTxFeesByAddressByChain,
    pspStakesByAddress,
  );

  // compute mapping(networkId => MerkleTree)
  logger.info(`compute merkleTree by chain`);
  const merkleTreeByChain = await computeMerkleTreeDataAllChains(
    gasRefundByAddressByChain,
    epochNum,
  );

  // @TODO: store merkleTreeByChain in db (or file to start with) with epochNum
  console.log({ merkleTreeByChain: JSON.stringify(merkleTreeByChain) });
  // todo: determine if epoch is over (epoch endtime < [now])
  await writeCompletedEpochData(merkleTreeByChain, pspStakesByAddress)

}

// todo: delete later - just created while developing
const seedDB = async () => {
  await Database.connectAndSync()
}

start(epochNum);
// seedDB();
