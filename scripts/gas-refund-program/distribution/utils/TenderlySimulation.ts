import { TransactionRequest } from '@ethersproject/providers';
import axios from 'axios';

const TENDERLY_TOKEN = process.env.TENDERLY_TOKEN;
const TENDERLY_ACCOUNT_ID = process.env.TENDERLY_ACCOUNT_ID;
const TENDERLY_PROJECT = process.env.TENDERLY_PROJECT;
const TENDERLY_FORK_ID = process.env.TENDERLY_FORK_ID;
const TENDERLY_FORK_LAST_TX_ID = process.env.TENDERLY_FORK_LAST_TX_ID;

export class TenderlySimulation {
  lastTx: string = '';
  forkId: string = '';
  maxGasLimit = 80000000;

  constructor(private network: Number = 1) {}

  async setup() {
    // Fork the mainnet
    if (!TENDERLY_TOKEN)
      throw new Error(
        `TenderlySimulation_setup: TENDERLY_TOKEN not found in the env`,
      );

    if (TENDERLY_FORK_ID) {
      if (!TENDERLY_FORK_LAST_TX_ID) throw new Error('Always set last tx id');
      this.forkId = TENDERLY_FORK_ID;
      this.lastTx = TENDERLY_FORK_LAST_TX_ID;
      return;
    }

    try {
      let res = await axios.post(
        `https://api.tenderly.co/api/v1/account/${TENDERLY_ACCOUNT_ID}/project/${TENDERLY_PROJECT}/fork`,
        {
          network_id: this.network.toString(),
          shared: true,
        },
        {
          timeout: 20000,
          headers: {
            'x-access-key': TENDERLY_TOKEN,
          },
        },
      );
      this.forkId = res.data.simulation_fork.id;
      this.lastTx = res.data.root_transaction.id;
    } catch (e) {
      console.error(`TenderlySimulation_setup:`, e);
      throw e;
    }
  }

  get forkUrl() {
    return `https://dashboard.tenderly.co/${TENDERLY_ACCOUNT_ID}/${TENDERLY_PROJECT}/fork/${this.forkId}`;
  }

  get publicForkUrl() {
    return `https://dashboard.tenderly.co/shared/fork/${this.forkId}/transactions`;
  }

  async simulate(params: TransactionRequest, isPublic = false) {
    const _params = {
      from: params.from,
      to: params.to,
      save: true,
      root: this.lastTx,
      value: params.value || '0',
      gas: this.maxGasLimit,
      input: params.data,
      state_objects: {},
    };
    try {
      const { data } = await axios.post(
        `https://api.tenderly.co/api/v1/account/${TENDERLY_ACCOUNT_ID}/project/${TENDERLY_PROJECT}/fork/${this.forkId}/simulate`,
        _params,
        {
          timeout: 20 * 1000,
          headers: {
            'x-access-key': TENDERLY_TOKEN!,
          },
        },
      );
      const lastTx = data.simulation.id;
      if (data.transaction.status) {
        this.lastTx = lastTx;
        const tenderlyUrl = !isPublic
          ? `https://dashboard.tenderly.co/${TENDERLY_ACCOUNT_ID}/${TENDERLY_PROJECT}/fork/${this.forkId}/simulation/${lastTx}`
          : `https://dashboard.tenderly.co/public/${TENDERLY_ACCOUNT_ID}/${TENDERLY_PROJECT}/fork-simulation/${lastTx}`;
        return {
          success: true,
          gasUsed: data.transaction.gas_used,
          tenderlyUrl,
          transaction: data.transaction,
        };
      } else {
        const tenderlyUrl = !isPublic
          ? `https://dashboard.tenderly.co/${TENDERLY_ACCOUNT_ID}/${TENDERLY_PROJECT}/fork/${this.forkId}/simulation/${lastTx}`
          : `https://dashboard.tenderly.co/public/${TENDERLY_ACCOUNT_ID}/${TENDERLY_PROJECT}/fork-simulation/${lastTx}`;
        return {
          success: false,
          tenderlyUrl,
          error: `Simulation failed: ${data.transaction.error_info.error_message} at ${data.transaction.error_info.address}`,
        };
      }
    } catch (e) {
      console.error(`TenderlySimulation_simulate:`, e);
      return {
        success: false,
        tenderlyUrl: '',
      };
    }
  }
}
