import BigNumber from 'bignumber.js';
import { fetchRawReceipt } from '../../src/lib/fetch-tx-gas-used';
import { computeOverriddenFieldsForL2IfApplicable } from '../../src/lib/utils/l1fee-worakround';
import { ExtendedCovalentGasRefundTransaction } from '../../src/types-from-scripts';
import { PatchedTxTuple } from './types';
import { Provider } from '../../src/lib/provider';

export async function extendPatchTx(
  tuples: PatchedTxTuple[],
): Promise<ExtendedCovalentGasRefundTransaction[]> {
  const rawReceipts = await Promise.all(
    tuples.map(async ([chainId, txHash]) => {
      const receipt = await fetchRawReceipt({
        txHash,
        chainId,
      });
      return [chainId, receipt];
    }),
  );

  return Promise.all(
    rawReceipts.map(async ([chainId, rawReceipt]) => {
      const block = await Provider.getJsonRpcProvider(chainId).getBlock(
        rawReceipt.blockNumber,
      );

      // TODO: same hack applied in other place. Find a better way to handle
      const { txGasPrice, gasSpentInChainCurrencyWei } =
        computeOverriddenFieldsForL2IfApplicable({
          chainId,
          gasUsedOnTxChain: rawReceipt.gasUsed,
          l1FeeIfApplicable: rawReceipt.l1Fee || 0,
          originalGasPriceFromReceipt: rawReceipt.effectiveGasPrice,
        }); // virtually scaling gasPrice up for optimism to take into account for L1 tx fees submission (dirty fix, shouldn't cause too much troubles)

      const result: ExtendedCovalentGasRefundTransaction = {
        txOrigin: rawReceipt.from.toLowerCase(),
        txGasPrice,
        blockNumber: new BigNumber(rawReceipt.blockNumber).toFixed(),
        timestamp: block.timestamp.toString(),
        txGasUsed: new BigNumber(rawReceipt.gasUsed).toFixed(),
        gasSpentInChainCurrencyWei,
        contract: rawReceipt.to.toLowerCase(),
        txHash: rawReceipt.transactionHash.toLowerCase(),
      };
      return result;
    }),
  );
}
