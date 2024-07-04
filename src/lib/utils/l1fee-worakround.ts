import BigNumber from 'bignumber.js';
import { ExtendedCovalentGasRefundTransaction } from '../../types-from-scripts';
import { CHAIN_ID_OPTIMISM } from '../constants';

export function computeOverriddenFieldsForL2IfApplicable({
  chainId,
  gasUsedOnTxChain,
  originalGasPriceFromReceipt,
  l1FeeIfApplicable,
}: {
  gasUsedOnTxChain: number; // l2 or l1
  chainId: number;
  l1FeeIfApplicable: string;
  originalGasPriceFromReceipt: string;
}): Pick<
  ExtendedCovalentGasRefundTransaction,
  'txGasPrice' | 'gasSpentInChainCurrencyWei'
> {
  const gasSpentInChainCurrencyWeiPrecise = new BigNumber(gasUsedOnTxChain)
    .multipliedBy(originalGasPriceFromReceipt)
    .plus(chainId === CHAIN_ID_OPTIMISM ? l1FeeIfApplicable : 0)
    .toFixed();

  if (chainId === CHAIN_ID_OPTIMISM) {
    // due to loss of precision in earlier implemented logic, having to reproduce this loss of precision here
    // ref: scripts/gas-refund-program/transactions-indexing/fetchRefundableTransactions.ts
    const txGasPrice = new BigNumber(gasSpentInChainCurrencyWeiPrecise)
      .dividedBy(gasUsedOnTxChain)

      .toFixed(0, BigNumber.ROUND_DOWN);

    const gasSpentInChainCurrencyWei = new BigNumber(gasUsedOnTxChain)
      .multipliedBy(txGasPrice)
      .toFixed();
    return {
      txGasPrice: txGasPrice,
      gasSpentInChainCurrencyWei,
    };
  }
  return {
    txGasPrice: originalGasPriceFromReceipt,
    gasSpentInChainCurrencyWei: gasSpentInChainCurrencyWeiPrecise,
  };
}
