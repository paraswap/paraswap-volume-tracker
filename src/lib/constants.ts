export const CHAIN_ID_MAINNET = 1;
export const CHAIN_ID_ROPSTEN = 3;
export const CHAIN_ID_BINANCE = 56;
export const CHAIN_ID_POLYGON = 137;
export const CHAIN_ID_AVALANCHE = 43114;
export const CHAIN_ID_FANTOM = 250;

export const STAKING_CHAIN_IDS = [CHAIN_ID_MAINNET, CHAIN_ID_ROPSTEN];
export const STAKING_CHAIN_IDS_SET = new Set([
  CHAIN_ID_MAINNET,
  CHAIN_ID_ROPSTEN,
]);

export const VOLUME_TRACKER_SUPPORTED_NETWORKS = [CHAIN_ID_MAINNET];


// TODO: in future we can fetch it from the api directly
export const ZeroXV2Address: { [network: number]: string } = {
  [CHAIN_ID_MAINNET]: '0x080bf510fcbf18b91105470639e9561022937712',
};

// TODO: in future we can fetch it from the api directly
export const ZeroXV4Address: { [network: number]: string } = {
  [CHAIN_ID_MAINNET]: '0xdef1c0ded9bec7f1a1670819833240f027b25eff',
};


export type MulticallEncodedData = { returnData: string[] };

export const DEFAULT_CHAIN_ID = parseInt(process.env.DEFAULT_CHAIN_ID || '1');

export const NULL_ADDRESS = '0x0000000000000000000000000000000000000000';

export const NATIVE_TOKEN_ADDRESS =
  '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

export const SAFETY_MODULE_ADDRESS =
  '0xc8dc2ec5f5e02be8b37a8444a1931f02374a17ab';

export const AUGUSTUS_V5_ADDRESS = '0xdef171fe48cf0115b1d80b88dc8eab59176fee57';

export const BalancerVaultAddress =
  '0xba12222222228d8ba445958a75a0704d566bf2c8';
export const Balancer_80PSP_20WETH_poolId =
  '0xcb0e14e96f2cefa8550ad8e4aea344f211e5061d00020000000000000000011a';
export const Balancer_80PSP_20WETH_address =
  Balancer_80PSP_20WETH_poolId.substring(0, 42); // or 0xcb0e14e96f2cefa8550ad8e4aea344f211e5061d

export const CONFIG_VOLUME_TRACKER_INIT_TIME_1 =16198272
