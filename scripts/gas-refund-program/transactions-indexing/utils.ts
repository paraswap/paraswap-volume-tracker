import { Provider } from '../../../src/lib/provider';

const Bottleneck = require('bottleneck');

const limiter = new Bottleneck({
  minTime: 200, // 200ms interval between calls (5 calls per second)
});

const _fetchTxGasUsed = async (
  chainId: number,
  txHash: string,
): Promise<number> => {
  const provider = Provider.getJsonRpcProvider(chainId);
  const tx = await provider.getTransactionReceipt(txHash);
  const txGasUsed = tx.gasUsed.toNumber();
  return txGasUsed;
};

export const fetchTxGasUsed = limiter.wrap(_fetchTxGasUsed);
