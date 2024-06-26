import { assert } from 'ts-essentials';
import { ExtendedCovalentGasRefundTransaction } from '../types-from-scripts';
import axios from 'axios';
import { CHAIN_ID_OPTIMISM } from './constants';
import BigNumber from 'bignumber.js';
import { fetchTxGasUsed } from './fetch-tx-gas-used';

const PARASWAP_V6_STAKERS_TRANSACTIONS_URL_TEMPLATE =
  process.env.PARASWAP_V6_STAKERS_TRANSACTIONS_URL_TEMPLATE;

type ParaswapTransactionData = {
  chainid: number; // 137,
  initiator: string; // '0xad1a74a31b00ed0403bb7d8b11130e30ae15853c',
  augustusversion: string; //'6.2',
  augustusaddress: string; // '0x6a000f20005980200259b80c5102003040001068',
  entrytimestamp: string; //'2024-06-24T10:36:52Z',
  txgasused: number; // 403796,
  txgasprice: number; // 118000000000,
  blocknumber: number; // 58545814,
  blockhash: string; // '0xb1fdf818d10b1b2d97d82ff421972b03e1e04ceafaa5237c8373e705531e4617',
  txhash: string; //'0xca4c03b4e1fc17553706f9b91a3dd7eaa20202927e3ef77aa31dfdfc04ca4b16'
};
function generateObjectsFromData(data: any): ParaswapTransactionData[] {
  // Dynamically extract column names from the 'cols' array
  const columnNames = data.cols.map((col: any) => col.name);

  // Assuming 'rows' is an array of arrays, where each inner array represents a row of values
  // Map each row to an object, where the key is the column name and the value is the corresponding row value
  return data.rows.map((row: any[]) => {
    const obj: { [key: string]: any } = {};
    row.forEach((value, index) => {
      // Use the dynamically extracted column name
      const columnName = columnNames[index];
      obj[columnName] = value;
    });
    return obj;
  });
}
const logger = global.LOGGER('paraswap-v6-stakers-transactions');

export async function fetchParaswapV6StakersTransactions(arg0: {
  epoch: number;
  chainId: number;
  address: string;
  timestampGreaterThan?: number;
}): Promise<ExtendedCovalentGasRefundTransaction[]> {
  assert(
    PARASWAP_V6_STAKERS_TRANSACTIONS_URL_TEMPLATE,
    'PARASWAP_V6_STAKERS_TRANSACTIONS_URL_TEMPLATE should be defined',
  );
  const url = PARASWAP_V6_STAKERS_TRANSACTIONS_URL_TEMPLATE.replace(
    '{{epoch}}',
    arg0.epoch.toString(),
  )
    .replace('{{chainId}}', arg0.chainId.toString())
    .replace('{{contractAddressLowerCase}}', arg0.address)
    .replace(
      '{{timestampGreaterThan}}',
      arg0.timestampGreaterThan ? `"${arg0.timestampGreaterThan}"` : 'null',
    );

  const data = await axios.get(url);

  logger.info('paraswap v6 stakers txs: url: ', url);
  const formattedAsObjects = generateObjectsFromData(data.data.data);
  logger.info(
    'paraswap v6 stakers txs: amount fetched:',
    formattedAsObjects.length,
  );

  const items = await Promise.all(
    formattedAsObjects.map<Promise<ExtendedCovalentGasRefundTransaction>>(
      async item => {
        let gasSpentInChainCurrencyWei: string | undefined = undefined;

        if (arg0.chainId === CHAIN_ID_OPTIMISM) {
          const { gasUsed, l1FeeWei } = await fetchTxGasUsed(
            arg0.chainId,
            item.txhash,
          );
          assert(l1FeeWei, 'l1FeeWei should be defined on optimism');
          gasSpentInChainCurrencyWei = new BigNumber(gasUsed)
            .multipliedBy(item.txgasprice.toString())
            .plus(l1FeeWei)
            .toFixed(0);
        }

        const timestamp = Math.floor(
          new Date(item.entrytimestamp).getTime() / 1000,
        ).toString();
        return {
          txHash: item.txhash,
          txOrigin: item.initiator,
          txGasPrice: item.txgasprice.toString(),
          blockNumber: item.blocknumber.toString(),
          timestamp,
          txGasUsed: item.txgasused.toString(),
          gasSpentInChainCurrencyWei,
          contract: item.augustusaddress,
        };
      },
    ),
  );
  return items;
}
