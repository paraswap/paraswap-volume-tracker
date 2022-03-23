import { TxFeesByAddress } from './types';

/**
 * fetch total PSP balances of all addresses for all pools
 */
export async function fetchPSPStakes(accTxFeesByAddressByChain: {
  [chainId: number]: TxFeesByAddress;
}): Promise<{ [address: string]: bigint } | null> {
  const allAddresses = new Set(
    Object.values(accTxFeesByAddressByChain).flatMap(v => Object.keys(v)),
  );

  console.log(allAddresses); // @TODO multicall sPSPs and query PSPBalance() for all addresses

  return null;
}
