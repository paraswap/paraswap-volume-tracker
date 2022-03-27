import { assert } from 'ts-essentials';
import { BlockInfo } from '../../lib/block-info';
import { SwapsTracker } from '../../lib/swaps-tracker';
import { HistoricalPrice, TxFeesByAddress, InitialEpochData } from './types';
import { BigNumber } from 'bignumber.js';

import { EpochGasRefund } from '../../models/EpochGasRefund';

const logger = global.LOGGER('GRP');

export async function computeAccumulatedTxFeesByAddress({
  chainId,
  startTimestamp,
  endTimestamp,
  pspNativeCurrencyDailyRate,
  epoch
}: {
  chainId: number;
  startTimestamp: number;
  endTimestamp: number;
  pspNativeCurrencyDailyRate: HistoricalPrice;
  epoch: number
}) {
  const swapTracker = SwapsTracker.getInstance(chainId, true);
  const blockInfo = BlockInfo.getInstance(chainId);
  const [startBlock, endBlock] = await Promise.all([
    blockInfo.getBlockAfterTimeStamp(startTimestamp),
    blockInfo.getBlockAfterTimeStamp(endTimestamp),
  ]);

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
  await swapTracker.indexSwaps(startBlock, endBlock);

  const swapsByBlock = swapTracker.indexedSwaps;

  logger.info(`swapTracker indexed ${Object.keys(swapsByBlock).length} blocks`);


  // todo: this will be filled in per splice/batch of data from mo's PR
  let initialIncompleteEpochData: InitialEpochData[] = []

  const accumulatedTxFeesByAddress = Object.entries(
    swapsByBlock,
  ).reduce<TxFeesByAddress>((acc, [, swapsInBlock]) => {
    swapsInBlock.forEach(swap => {
      const swapperAcc = acc[swap.txOrigin];

      const pspRateSameDay = pspNativeCurrencyDailyRate.find(
        p => swap.timestamp > p.timestamp,
      ); // @FIXME: likely not correct, suboptimal

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
        .multipliedBy(pspRateSameDay.rate);

      const accGasFeePSP = (swapperAcc?.accGasFeePSP || new BigNumber(0)).plus(
        currGasFeePSP,
        //@TODO: debug data (acc gas used, avg gas price)
      );

      const initialEpochData: InitialEpochData = {
        epoch,
        address: swap.txOrigin,
        chainId: chainId.toString(),
        accumulatedGasUsedPSP: accGasFeePSP.toFixed(0), // todo: make safe
        lastBlockNum: swap.blockNumber,
      }

      initialIncompleteEpochData.push(initialEpochData);

      acc[swap.txOrigin] = {
        accGasFeePSP,
        lastBlockNum: endBlock
      };
    });

    return acc;
  }, {});

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

    const { epoch, address, chainId } = initialEpochData
    const { accumulatedGasUsedPSP, lastBlockNum } = initialEpochData

    const row = await EpochGasRefund.findOne({ where: { epoch, address, chainId }})
    if (row) {
      await row.update({accumulatedGasUsedPSP, lastBlockNum})
    } else {
      await EpochGasRefund.create(initialEpochData)
    }
  }




  logger.info(
    `computed accumulated tx fees for ${
      Object.keys(accumulatedTxFeesByAddress).length
    } addresses`,
  );

  return accumulatedTxFeesByAddress;
}
