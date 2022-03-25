import { CHAIN_ID_MAINNET } from '../../lib/constants';
import { TxFeesByAddress } from './types';
import * as SPSPABI from '../../lib/abi/spsp.abi.json';
import { Provider } from '../../lib/provider';
import { PoolConfigsMap } from '../../lib/pool-info';
import { BigNumberish, BigNumber as EthersBN } from '@ethersproject/bignumber';
import { BigNumber } from 'bignumber.js';
// @ts-ignore
import { utils } from '@snapshot-labs/snapshot.js';

const logger = global.LOGGER('GRP:STAKING');

/**
 * fetch total PSP balances of all addresses for all pools
 * logic borrowed our own snaptshot strategy https://github.com/snapshot-labs/snapshot-strategies/blob/7a9cd1439187ccc95d4702249fd26de778ecd8a7/src/strategies/staked-psp-balance
 */
const SPSPs = PoolConfigsMap[CHAIN_ID_MAINNET].filter(p => p.isActive).map(
  p => p.address,
);

// @FIXME: nb of addresses can be relatively high. Consider partitioning the addresses into batches
export async function fetchPSPStakes(
  allAddresses: string[],
): Promise<{ [address: string]: BigNumber }> {
  logger.info(`fetching stakes for ${allAddresses.length} addresses`);

  const multicallContract = new utils.Multicaller(
    String(CHAIN_ID_MAINNET),
    Provider.getJsonRpcProvider(CHAIN_ID_MAINNET) as any,
    SPSPABI,
    { blockTag: 'latest' }, // @FIXME: pass epoch block number here
  );

  SPSPs.forEach(SPSP => {
    allAddresses.forEach(address => {
      const path = `${SPSP}_${address}`;
      //      logger.info(`muticall(${path}, ${SPSP}, 'PSPBalance', ${address})`);
      return multicallContract.call(path, SPSP, 'PSPBalance', [address]);
    });
  });
  const result: Record<string, BigNumberish> =
    await multicallContract.execute();

  const pspByAddress = Object.entries(result).reduce<Record<string, EthersBN>>(
    (accum, [path, balance]) => {
      const [, address] = path.split('_');

      if (EthersBN.from(balance).eq(0)) return accum;

      if (!accum[address]) accum[address] = EthersBN.from(0);
      accum[address] = accum[address].add(balance);

      return accum;
    },
    {},
  );

  logger.info(
    `successfully fetched stakes for ${
      Object.keys(pspByAddress).length
    } addresses`,
  );

  return Object.fromEntries(
    Object.entries(pspByAddress).map(([address, balance]) => [
      address,
      new BigNumber(balance.toString()),
    ]),
  );
}
