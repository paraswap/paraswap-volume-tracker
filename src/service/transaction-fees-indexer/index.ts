import {
  CHAIN_ID_BINANCE,
  CHAIN_ID_FANTOM,
  CHAIN_ID_MAINNET,
  CHAIN_ID_POLYGON,
} from '../../lib/constants';
import { reduceGasRefundByAddress } from './gas-refund';
import { computeMerkleData } from './merkle-tree';
import { fetchDailyPSPChainCurrencyRate } from './psp-native-chain-pricing';
import { computeAccumulatedTxFeesByAddress } from './transaction-fees';
import { fetchPSPStakes } from './staking';
import { Claimable, HistoricalPrice, TxFeesByAddress } from './types';

const epochNum = 7; // @TODO: read from EpochInfo
const epochStartTime = 1646668203; // @TODO: read from EpochInfo
const epochEndTime = 1647964203; // @TODO: read from EpochInfo

const GRP_SUPPORTED_CHAINS = [
  CHAIN_ID_MAINNET,
  CHAIN_ID_POLYGON,
  CHAIN_ID_BINANCE,
  CHAIN_ID_FANTOM,
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
  // retrieve daily psp/native currency rate for (epochStartTime, epochEndTime)
  const pspNativeCurrencyDailyRateByChain =
    await fetchDailyPSPChainCurrencyAllChains({
      startTimestamp: epochStartTime,
      endTimestamp: epochEndTime,
    });

  // retrieve all tx beetween (start_epoch_timestamp, end_epoch_timestamp) +  compute progressively mapping(chainId => address => mapping(timestamp => accGasUsedPSP)) // address: txOrigin, timestamp: start of the day
  const accTxFeesByAddressByChain =
    await computeAccumulatedTxFeesByAddressAllChains({
      pspNativeCurrencyDailyRateByChain,
      startTimestamp: epochStartTime,
      endTimestamp: epochEndTime,
    });

  // retrieve mapping(address => totalStakes) where address is in dailyTxFeesByAddressByChain
  const pspStakesByAddress = await fetchPSPStakes(accTxFeesByAddressByChain);

  if (!pspStakesByAddress) throw new Error('could not retrieve PSP stakes');

  // combine data to form mapping(chainId => address => {totalStakes@debug, gasRefundPercent@debug, accGasUsedPSP@debug, refundAmount})  // amount = accGasUsedPSP * gasRefundPercent
  const gasRefundByAddressByChain = reduceGasRefundByAddressAllChains(
    accTxFeesByAddressByChain,
    pspStakesByAddress,
  );

  // compute mapping(networkId => MerkleTree)
  const merkleTreeByChain = computeMerkleTreeDataAllChains(
    gasRefundByAddressByChain,
    epochNum,
  );

  // @TODO: store merkleTreeByChain in db (or file to start with) with epochNum
  console.log({ merkleTreeByChain: JSON.stringify(merkleTreeByChain) });
}
