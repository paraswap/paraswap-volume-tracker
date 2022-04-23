import { BigNumber, Contract, Event as GenericEvent } from 'ethers';
import { CHAIN_ID_MAINNET } from '../../../src/lib/constants';
import { PoolConfigsMap } from '../../../src/lib/pool-info';
import { getTokenHolders } from './covalent';
import * as SPSPABI from '../../../src/lib/abi/spsp.abi.json';
import { Provider } from '../../../src/lib/provider';

interface PoolWithStakers {
  pool: string;
  chainId: number;
  stakers: {
    staker: string;
    sPSPbalance: string;
  }[];
}

const SPSPs = PoolConfigsMap[CHAIN_ID_MAINNET].filter(p => p.isActive).map(
  p => p.address,
);

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const SPSPPrototypeContract = new Contract(ZERO_ADDRESS, SPSPABI);

interface Transfer extends GenericEvent {
  event: 'Transfer',
  args: [from: string, to: string, value: BigNumber]
}

interface Entered extends GenericEvent {
  event: 'Entered',
  args: [user: string, amount: BigNumber]
}

interface Unstaked extends GenericEvent {
  event: 'Unstaked',
  args: [id: string, user: string, amount: BigNumber]
}

interface Withdraw extends GenericEvent {
  event: 'Withdraw',
  args: [id: string, user: string, amount: BigNumber]
}

interface Reentered extends GenericEvent {
  event: 'Reentered',
  args: [id: string, user: string, amount: BigNumber]
}

type Event = Transfer | Entered | Unstaked | Withdraw | Reentered;

// fetch initial : global totalSupply / glboal psp balance / global  psp locked / spsp balance per account
// fetch events and parse and store in right timeseries data struct (related to all above) (keep sorted by timestamp)
// lookup function will recompute all data from sorted events, eventually will be memoised 
// quid

class StakersTracker {
  stakesByPool: PoolWithStakers[];
  initBlockNumber: number;
  pool2Contract: { [pool: string]: Contract } = {};

  constructor() {
    SPSPs.forEach(pool => {
      this.pool2Contract[pool] = SPSPPrototypeContract.attach(pool).connect(
        Provider.getJsonRpcProvider(CHAIN_ID_MAINNET),
      );
    });
  }

  async loadInitialStakesByPool(blockNumber: number) {
    const chainId = CHAIN_ID_MAINNET;

    this.stakesByPool = await Promise.all(
      SPSPs.map(async pool => {
        // @WARNING pagination doesn't seem to work, so ask a large pageSize
        const options = {
          pageSize: 10000,
          token: pool,
          chainId,
          blockHeight: String(blockNumber),
        };

        const { items } = await getTokenHolders(options);

        const stakers = items.map(item => ({
          staker: item.address,
          sPSPbalance: item.balance, // wei
        }));

        const result = {
          pool,
          chainId,
          stakers,
        };

        return result;
      }),
    );

    this.initBlockNumber = blockNumber;
  }

  async indexStakingEvents(targetBlockNumber: number) {
    const [fromBlock, toBlock] = [this.initBlockNumber, targetBlockNumber];

    await Promise.all(
      SPSPs.map(async pool => {
        const events = await this.pool2Contract[pool].queryFilter(
          '*' as any,
          fromBlock,
          toBlock,
        ) as Event[];

        const parsedEvents = events.map(e => {
          // store positive or negative diff at blocknumber for pool
          switch (e.event) {
            case 'Transfer': { // emitted on minting and burning + transfer
              const [from, to, amount] = e.args 


              if(from === ZERO_ADDRESS) {
                // increase totalsupply
                // add user sPSP balance
              }

              if(to === ZERO_ADDRESS) {
                // decrease totalsupply
                // remove user sPSP balance
              }

              // decrease from staker balance / increase to staker balance
              
            }

            case 'Entered': {
              const [user, amount] = e.args 
              
              // increase PSP balanceOf
            }

            case 'Unstaked': {
              const [id, user, amount] = e.args

              // increase PSP locked
            }

            case 'Withdraw': {
              const [id, user, amount] = e.args // remove PSP balance only ?
            }

            case 'Reentered': {
              const [id, user, amount] = e.args // add balance
            }

            default: // skip
          }
        });
      }),
    );
  }

  async getStakesAtBlock(staker: string, blockNumber: number): Promise<string> {
    return '0';
  }
}

export default new StakersTracker();
