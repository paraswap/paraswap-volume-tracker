import { CHAIN_ID_MAINNET } from '../../lib/constants';
import { TxFeesByAddress } from './types';
import * as SPSPABI from '../../lib/abi/spsp.abi.json';
import { Provider } from '../../lib/provider';
import { PoolConfigsMap } from '../../lib/pool-info';
import snapshot from '@snapshot-labs/snapshot.js'; // convient for smooth multicall implementation
import { BigNumberish, BigNumber } from '@ethersproject/bignumber';

/**
 * fetch total PSP balances of all addresses for all pools
 * logic borrowed our own snaptshot strategy https://github.com/snapshot-labs/snapshot-strategies/blob/7a9cd1439187ccc95d4702249fd26de778ecd8a7/src/strategies/staked-psp-balance
 */
const SPSPs = PoolConfigsMap[CHAIN_ID_MAINNET].filter(p => p.isActive);

const multicallContract = new snapshot.utils.Multicaller(
  String(CHAIN_ID_MAINNET),
  Provider.getJsonRpcProvider(CHAIN_ID_MAINNET) as any,
  SPSPABI,
  { blockTag: 'latest' },
);


// @FIXME: nb of addresses can be relatively high. Consider partitioning the addresses into batches
export async function fetchPSPStakes(accTxFeesByAddressByChain: {
  [chainId: number]: TxFeesByAddress;
}): Promise<{ [address: string]: bigint }> {
  const allAddresses = [
    ...new Set(
      Object.values(accTxFeesByAddressByChain).flatMap(v => Object.keys(v)),
    ),
  ];

  SPSPs.forEach(SPSP => {
    allAddresses.forEach(address => {
      const path = `${SPSP}_${address}`;
      return multicallContract.call(path, SPSP, 'PSPBalance', [address]);
    });
  });
  const result: Record<string, BigNumberish> =
    await multicallContract.execute();

  const pspByAddress = Object.entries(result).reduce<Record<string, BigNumber>>(
    (accum, [path, balance]) => {
      const [, address] = path.split('_');

      if (!accum[address]) return accum;

      accum[address] = accum[address].add(balance);

      return accum;
    },
    {},
  );

  return Object.fromEntries(
    Object.entries(pspByAddress).map(([address, balance]) => [
      address,
      balance.toBigInt(),
    ]),
  );
}
