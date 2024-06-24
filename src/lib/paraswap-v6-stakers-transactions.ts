import { assert } from 'ts-essentials';
import { CovalentGasRefundTransaction } from '../../scripts/gas-refund-program/types';
import axios from 'axios';

const PARASWAP_V6_STAKERS_TRANSACTIONS_URL_TEMPLATE =
  process.env.PARASWAP_V6_STAKERS_TRANSACTIONS_URL_TEMPLATE;

function generateObjectsFromData(data: any): object[] {
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

// Example usage
// Assuming 'data' is an object that contains both 'cols' and 'rows' arrays
// const processedData = generateObjectsFromData(data.data);

//   logged example at the time of writting
//   [
//     {
//       chainid: 137,
//       initiator: '0xad1a74a31b00ed0403bb7d8b11130e30ae15853c',
//       augustusversion: '6.2',
//       augustusaddress: '0x6a000f20005980200259b80c5102003040001068',
//       entrytimestamp: '2024-06-24T10:36:52Z',
//       txgasused: 403796,
//       txgasprice: 118000000000,
//       blocknumber: 58545814,
//       blockhash: '0xb1fdf818d10b1b2d97d82ff421972b03e1e04ceafaa5237c8373e705531e4617',
//       txhash: '0xca4c03b4e1fc17553706f9b91a3dd7eaa20202927e3ef77aa31dfdfc04ca4b16'
//     },
// console.log(processedData);

export async function fetchParaswapV6StakersTransactions(arg0: {
  epoch: number;
  chainId: number;
  address: string;
}): Promise<CovalentGasRefundTransaction[]> {
  assert(
    PARASWAP_V6_STAKERS_TRANSACTIONS_URL_TEMPLATE,
    'PARASWAP_V6_STAKERS_TRANSACTIONS_URL_TEMPLATE should be defined',
  );
  const url = PARASWAP_V6_STAKERS_TRANSACTIONS_URL_TEMPLATE.replace(
    '{{epoch}}',
    arg0.epoch.toString(),
  )
    .replace('{{chainId}}', arg0.chainId.toString())
    .replace('{{contractAddressLowerCase}}', arg0.address);
  const data = await axios.get(url);

  console.log('allStakersTransactionsDuringEpoch url', url);
  const formattedAsObjects = generateObjectsFromData(data.data.data);
  console.log('allStakersTransactionsDuringEpoch', formattedAsObjects.length);
  if (formattedAsObjects.length > 0) {
    // debugger;
  }
  // @TODO: transform to CovalentGasRefundTransaction[]
  return formattedAsObjects as any[];
}
