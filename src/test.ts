
import * as dotenv from 'dotenv';
dotenv.config();
import * as fs from 'fs'

import * as Swaps from '../scripts/gas-refund-program/transactions-indexing/swaps-subgraph'

const test = async () => {
  /*
  chainId: 1,
  startTimestamp: 1649073280,
  endTimestamp: 1649073600,

  chainId: 1,
  startTimestamp: 1649073600,
  endTimestamp: 1649095200,

  EPOCH
  chainId: 1,
  startTimestamp: 1647864000,
  endTimestamp: 1649073600,

  EPOCH
  chainId: 1,
  startTimestamp: 1650283200,
  endTimestamp: 1650295443,


  FTM:
  Epoch 9
  chainId: 250,
  startTimestamp: 1647864000,
  endTimestamp: 1649073600,

  Epoch 10
  chainId: 250,
  startTimestamp: 1649073600,
  endTimestamp: 1650283200,

  Epoch 11
  chainId: 250,
  startTimestamp: 1649073600,
  endTimestamp: 1650283200,
  */
 // epoch 10
  const swapRetrievalParams = {
    chainId: 56,
    startTimestamp: 1649073600,
    endTimestamp: 1650283200,
  }
  console.log(process.env.COVALENT_API_KEY)
  const swaps = await Swaps.getSwapsPerNetwork(swapRetrievalParams)
  console.log('swap count', swaps.length)

  fs.writeFileSync('covalent-swaps_BSC_10.json', JSON.stringify(swaps))
}

test()
