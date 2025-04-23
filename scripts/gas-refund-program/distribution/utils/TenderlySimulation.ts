import { TransactionRequest } from '@ethersproject/providers';
import axios from 'axios';
import { BigNumberish } from 'ethers';
import { assert } from 'ts-essentials';
import { v4 as uuidv4 } from 'uuid';

const TENDERLY_TOKEN = process.env.TENDERLY_TOKEN;
const TENDERLY_ACCOUNT_ID = process.env.TENDERLY_ACCOUNT_ID;
const TENDERLY_PROJECT = process.env.TENDERLY_PROJECT;
const DISTRIBUTED_EPOCH = process.env.DISTRIBUTED_EPOCH;

export class TenderlySimulation {
  vnetId: string = '';
  vnetPublicId: string = '';
  maxGasLimit = 80000000;

  constructor(private network: Number = 1) {}

  async setup() {
    // Fork the mainnet
    if (!TENDERLY_TOKEN)
      throw new Error(
        `TenderlySimulation_setup: TENDERLY_TOKEN not found in the env`,
      );

    const vnet_name = `distribution-${DISTRIBUTED_EPOCH}-${uuidv4()}`;

    try {
      let res = await axios.post(
        // `https://api.tenderly.co/api/v1/account/${TENDERLY_ACCOUNT_ID}/project/${TENDERLY_PROJECT}/fork`,
        `https://api.tenderly.co/api/v1/account/${TENDERLY_ACCOUNT_ID}/project/${TENDERLY_PROJECT}/vnets`,
        {
          slug: vnet_name,
          display_name: vnet_name,
          fork_config: {
            network_id: this.network,
            block_number: 'latest',
          },
          virtual_network_config: {
            chain_config: {
              chain_id: this.network,
            },
          },
          sync_state_config: {
            enabled: false,
          },
          explorer_page_config: {
            enabled: true,
            verification_visibility: 'bytecode',
          },
        },
        {
          timeout: 20000,
          headers: {
            'x-access-key': TENDERLY_TOKEN,
          },
        },
      );
      this.vnetId = res.data.id;
      // @ts-ignore TS7031
      const vnetPublicRpcUrl = res.data.rpcs.find(({ url, name }) => {
        return name === 'Public RPC';
      }).url;
      this.vnetPublicId = vnetPublicRpcUrl.split('/').pop();
      assert(this.vnetPublicId, 'vnetPublicId not found');
    } catch (e) {
      console.error(`TenderlySimulation_setup:`, e);
      throw e;
    }
  }

  get publicVnetUrl() {
    return `https://dashboard.tenderly.co/${TENDERLY_ACCOUNT_ID}/${TENDERLY_PROJECT}/testnet/${this.vnetPublicId}/transactions`;
  }

  async simulate(params: TransactionRequest, isPublic = false) {
    const _params = {
      callArgs: {
        from: params.from,
        to: params.to,
        gas: `0x${Number(this.maxGasLimit).toString(16)}`,
        gasPrice: '0x0',
        value: toHex(params.value),
        data: params.data,
      },
    };
    try {
      const url = `https://api.tenderly.co/api/v1/account/${TENDERLY_ACCOUNT_ID}/project/${TENDERLY_PROJECT}/vnets/${this.vnetId}/transactions`;
      const { data } = await axios.post(url, _params, {
        timeout: 20 * 1000,
        headers: {
          'x-access-key': TENDERLY_TOKEN!,
        },
      });

      if (data.status === 'success') {
        const tenderlyUrl = data.public_explorer_url;
        return {
          success: true,
          // gasUsed,
          tenderlyUrl,
          transaction: data.transaction,
        };
      } else {
        const tenderlyUrl = data.public_explorer_url;
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

function toHex(value?: BigNumberish): string {
  if (value === undefined) return '0x0';

  if (typeof value === 'string' && value.startsWith('0x')) return value;

  if (typeof value === 'string') {
    return `0x${parseInt(value).toString(16)}`;
  }

  if (typeof value === 'number') {
    return `0x${value.toString(16)}`;
  }
  throw new Error('toHex: unsupported type');
}
