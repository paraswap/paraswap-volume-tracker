import { assert } from 'ts-essentials';
import { BlockInfo } from '../../lib/block-info';
import { SwapsTracker } from '../../lib/swaps-tracker';
import { HistoricalPrice, TxFeesByAddress, InitialEpochData } from './types';
import { BigNumber } from 'bignumber.js';
import { constructSameDayPrice } from './psp-chaincurrency-pricing';
import { EpochGasRefund } from '../../models/EpochGasRefund';

const logger = global.LOGGER('GRP:TRANSACTION_FEES_INDEXING');

const PARTITION_SIZE = 100; // depends on thegraph capacity and memory

export async function computeAccumulatedTxFeesByAddress({
  chainId,
  startTimestamp,
  endTimestamp,
  pspNativeCurrencyDailyRate,
  epoch,
}: {
  chainId: number;
  startTimestamp: number;
  endTimestamp: number;
  pspNativeCurrencyDailyRate: HistoricalPrice;
  epoch: number;
}) {
  const swapTracker = SwapsTracker.getInstance(chainId, true);
  const blockInfo = BlockInfo.getInstance(chainId);
  const [startBlock, endBlock] = await Promise.all([
    blockInfo.getBlockAfterTimeStamp(startTimestamp),
    blockInfo.getBlockAfterTimeStamp(endTimestamp),
  ]);
  const findSameDayPrice = constructSameDayPrice(pspNativeCurrencyDailyRate);

  assert(
    startBlock,
    `no start block found for chain ${chainId} for timestamp ${startTimestamp}`,
  );
  assert(
    endBlock,
    `no start block found for chain ${chainId} for timestamp ${endTimestamp}`,
  );

  /** @TODO: partitioning (startBlock,endBlock) in k (what's best value for k ? 100 ? 1000 ?)
   * compute accumulated tx fees for address accross each partion
   * clean indexedSwaps at end of partition processing
   */
  logger.info(
    `swapTracker start indexing between ${startBlock} and ${endBlock}`,
  );

  let accumulatedTxFeesByAddress = {};

  for (
    let _startBlock = startBlock;
    _startBlock < endBlock;
    _startBlock += PARTITION_SIZE
  ) {
    let initialIncompleteEpochData: InitialEpochData[] = [];

    const _endBlock = Math.min(_startBlock + PARTITION_SIZE, endBlock);

    logger.info(
      `swapTracker start indexing partition between ${_startBlock} and ${_endBlock}`,
    );

    await swapTracker.indexSwaps(_startBlock, _endBlock);

    const swapsByBlock = swapTracker.indexedSwaps;

    logger.info(
      `swapTracker indexed ${Object.keys(swapsByBlock).length} blocks`,
    );

    accumulatedTxFeesByAddress = Object.entries(
      swapsByBlock,
    ).reduce<TxFeesByAddress>((acc, [, swapsInBlock]) => {
      swapsInBlock.forEach(swap => {
        const swapperAcc = acc[swap.txOrigin];

        const pspRateSameDay = findSameDayPrice(swap.timestamp);

        if (!pspRateSameDay) {
          logger.warn(
            `Fail to find price for same day ${
              swap.timestamp
            } and rates=${JSON.stringify(
              pspNativeCurrencyDailyRate.flatMap(p => p.timestamp),
            )}`,
          );

          return;
        }

        const currGasFeePSP = new BigNumber(swap.txGasUsed.toString())
          .multipliedBy(swap.txGasPrice.toString()) // in gwei
          .multipliedBy(1e9) //  convert to wei
          .multipliedBy(pspRateSameDay);

        const accGasFeePSP = (
          swapperAcc?.accGasFeePSP || new BigNumber(0)
        ).plus(
          currGasFeePSP,
          //@TODO: debug data (acc gas used, avg gas price)
        );

        const initialEpochData: InitialEpochData = { // @fixme remove initailEpochData to use acc
          epoch,
          address: swap.txOrigin,
          chainId: chainId.toString(),
          accumulatedGasUsedPSP: accGasFeePSP.toFixed(0), // todo: make safe
          lastBlockNum: swap.blockNumber,
        };

        initialIncompleteEpochData.push(initialEpochData);

        acc[swap.txOrigin] = {
          accGasFeePSP,
          lastBlockNum: swap.blockNumber,
        };
      });

      return acc;
    }, accumulatedTxFeesByAddress);

    // todo: bulk insert/upsert initial epoch data at end of slice of above data once merged with mo's pr

    // todo: bulkCreate must work in postgres?
    /**
   * ideally I'd just do a bulkCreate with update options for unique
   * identifier clashes. but that seems problematic with postgres.
   * will look into more later, for now I do each row one at a time...
   *
   * await EpochGasRefund.bulkCreate(initialIncompleteEpochData, {
      updateOnDuplicate: ['accumulatedGasUsedPSP', 'lastBlockNum'],
    })
    */
    for (let i = 0; i < initialIncompleteEpochData.length; i++) {
      const initialEpochData = initialIncompleteEpochData[i];

      const { epoch, address, chainId } = initialEpochData;
      const { accumulatedGasUsedPSP, lastBlockNum } = initialEpochData;

      const row = await EpochGasRefund.findOne({
        where: { epoch, address, chainId },
      });
      if (row) {
        await row.update({ accumulatedGasUsedPSP, lastBlockNum });
      } else {
        await EpochGasRefund.create(initialEpochData);
      }
    }

    swapTracker.indexedSwaps = {}; // cleaning step
  }

  logger.info(
    `computed accumulated tx fees for ${
      Object.keys(accumulatedTxFeesByAddress).length
    } addresses`,
  );

  return accumulatedTxFeesByAddress;
}
