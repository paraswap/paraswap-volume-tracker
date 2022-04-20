
import * as dotenv from 'dotenv';
dotenv.config();
import * as fs from 'fs'

import * as Swaps from '../scripts/gas-refund-program/transactions-indexing/swaps-subgraph'
import * as GRP from './lib/gas-refund'

const testDataPath = (chainId: number, epoch: number, startTimestamp: number, endTimestamp: number): string => `seed-data/covalent_chain:${chainId}_epoch:${epoch}_${startTimestamp}-${endTimestamp}.json`

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
  const epoch = 10
  const swapRetrievalParams = {
    chainId: 56,
    startTimestamp: 1649073600,
    endTimestamp: 1650283200,
  }
  console.log(process.env.COVALENT_API_KEY)
  const swaps = await Swaps.getSwapsPerNetwork(swapRetrievalParams)
  console.log('swap count', swaps.length)

  fs.writeFileSync('covalent-swaps_BSC_10.json', JSON.stringify(swaps))

  // ftm has an issue on covalent just now
  const chains = GRP.GRP_SUPPORTED_CHAINS.filter(chain => chain !== 250)
  // get test data for each chain and store it in a seed dir for use elsewhere
  chains.forEach(async chainId => {
    const { startTimestamp, endTimestamp } =swapRetrievalParams
    const swaps = await Swaps.getSwapsPerNetwork({
      startTimestamp,
      endTimestamp,
      chainId,
    })
    const path = testDataPath(chainId, epoch, startTimestamp, endTimestamp)

    if (!fs.existsSync('seed-data')){
      fs.mkdirSync('seed-data');
    }
    fs.writeFileSync(path, JSON.stringify(swaps))
  })
}


export const readStoredCovalentTXs = (chainId: number, epoch: number, startTimestamp: number, endTimestamp: number): Swaps.CovalentSwap[] => {
  const path = testDataPath(chainId, epoch, startTimestamp, endTimestamp)

  const covalentTXs: Swaps.CovalentSwap[] = JSON.parse(fs.readFileSync(path).toString())
  return covalentTXs
}

test()
