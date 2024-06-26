import { BigNumber } from 'bignumber.js';
import { Provider } from '../../../src/lib/provider';

const Bottleneck = require('bottleneck');

const limiter = new Bottleneck({
  minTime: 200, // 200ms interval between calls (5 calls per second)
});

type RpcGasUsedFetcher = (chainId: number, txHash: string) => Promise<{gasUsed: number, l1FeeWei: null | string }>;
const _fetchTxGasUsed: RpcGasUsedFetcher = async (
  chainId: number,
  txHash: string,
) => {
  const provider = Provider.getJsonRpcProvider(chainId);
  
  // const tx = await provider.getTransactionReceipt(txHash);
  // using raw request and not ethers.js method to avoid formatting and stripping l1FeeWei in particular
  const txReceiptRaw = await provider.send('eth_getTransactionReceipt', 
    
    [txHash],
  )
  
   return {
    gasUsed: new BigNumber(txReceiptRaw.gasUsed).toNumber(), // gas used on the layer of transaction
    l1FeeWei: txReceiptRaw.l1Fee ? new BigNumber(txReceiptRaw.l1Fee).toFixed() : null // l1Fee is only present on layer 2 transactions
  
  };
};

export const fetchTxGasUsed: RpcGasUsedFetcher = limiter.wrap(_fetchTxGasUsed);
