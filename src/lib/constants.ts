export const CHAIN_ID_MAINNET = 1;
export const CHAIN_ID_ROPSTEN = 3;
export const CHAIN_ID_GOERLI = 5;
export const CHAIN_ID_BINANCE = 56;
export const CHAIN_ID_POLYGON = 137;
export const CHAIN_ID_AVALANCHE = 43114;
export const CHAIN_ID_FANTOM = 250;

export const PSP_ADDRESS: { [chainId: number]: string } = {
  [CHAIN_ID_MAINNET]: '0xcafe001067cdef266afb7eb5a286dcfd277f3de5',
  [CHAIN_ID_BINANCE]: '0xcafe001067cdef266afb7eb5a286dcfd277f3de5',
  [CHAIN_ID_FANTOM]: '0xcafe001067cdef266afb7eb5a286dcfd277f3de5',
  [CHAIN_ID_POLYGON]: '0x42d61d766b85431666b39b89c43011f24451bff6',
};

export const STAKING_CHAIN_IDS = [CHAIN_ID_MAINNET, CHAIN_ID_ROPSTEN];
export const STAKING_CHAIN_IDS_SET = new Set([
  CHAIN_ID_MAINNET,
  CHAIN_ID_ROPSTEN,
]);

export const VOLUME_TRACKER_SUPPORTED_NETWORKS = [CHAIN_ID_MAINNET];
export const VOLUME_TRACKER_INIT_TIME: { [network: number]: number } = {
  [CHAIN_ID_MAINNET]: parseInt(process.env.INIT_TIME || '0'), //TODO: use the block info to the init time from the init block
};

export const Web3Provider: { [network: number]: string } = {
  [CHAIN_ID_MAINNET]: process.env.HTTP_PROVIDER || '',
  [CHAIN_ID_ROPSTEN]: process.env.HTTP_PROVIDER_3 || '',
  [CHAIN_ID_GOERLI]: process.env.HTTP_PROVIDER_5 || 'https://rpc.ankr.com/eth_goerli',
  [CHAIN_ID_BINANCE]: process.env.HTTP_PROVIDER_56 || '',
  [CHAIN_ID_POLYGON]: process.env.HTTP_PROVIDER_137 || '',
  [CHAIN_ID_FANTOM]: process.env.HTTP_PROVIDER_250 || '',
  [CHAIN_ID_AVALANCHE]: process.env.HTTP_PROVIDER_43114 || '',
};

// TODO: in future we can fetch it from the api directly
export const AugustusV5Address: { [network: number]: string } = {
  [CHAIN_ID_MAINNET]: '0xdef171fe48cf0115b1d80b88dc8eab59176fee57',
  [CHAIN_ID_BINANCE]: '0xdef171fe48cf0115b1d80b88dc8eab59176fee57',
  [CHAIN_ID_POLYGON]: '0xdef171fe48cf0115b1d80b88dc8eab59176fee57',
};

export const AugustusV4Address: { [network: number]: string } = {
  [CHAIN_ID_MAINNET]: '0x1bd435f3c054b6e901b7b108a0ab7617c808677b',
  [CHAIN_ID_BINANCE]: '0x55A0E3b6579972055fAA983482acEb4B251dcF15',
  [CHAIN_ID_POLYGON]: '0x90249ed4d69D70E709fFCd8beE2c5A566f65dADE',
};

export const RewardDistributionAddress: { [network: string]: string } = {
  [CHAIN_ID_MAINNET]: '0x8145cDeeD63e2E3c103F885CbB2cD02a00F54873',
};

// TODO: in future we can fetch it from the api directly
export const ZeroXV2Address: { [network: number]: string } = {
  [CHAIN_ID_MAINNET]: '0x080bf510fcbf18b91105470639e9561022937712',
};

// TODO: in future we can fetch it from the api directly
export const ZeroXV4Address: { [network: number]: string } = {
  [CHAIN_ID_MAINNET]: '0xdef1c0ded9bec7f1a1670819833240f027b25eff',
};

// TODO: set using env variable
export const ParaswapApiURL = 'https://apiv5.paraswap.io';

export const MULTICALL_ADDRESS: any = {
  [CHAIN_ID_MAINNET]: '0xeefba1e63905ef1d7acba5a8513c70307c1ce441',
  [CHAIN_ID_ROPSTEN]: '0x293405FE3aDefDB94A8A1Ed50873a15C6Cc83BC5',
  [CHAIN_ID_BINANCE]: '0xdc6e2b14260f972ad4e5a31c68294fba7e720701',
  [CHAIN_ID_POLYGON]: '0xdC6E2b14260F972ad4e5a31c68294Fba7E720701',
  [CHAIN_ID_FANTOM]: '0xdC6E2b14260F972ad4e5a31c68294Fba7E720701',
};

export type MulticallEncodedData = { returnData: string[] };

export const DEFAULT_CHAIN_ID = parseInt(process.env.DEFAULT_CHAIN_ID || '1');

export const NULL_ADDRESS = '0x0000000000000000000000000000000000000000';

export const NATIVE_TOKEN_ADDRESS =
  '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

export const SAFETY_MODULE_ADDRESS =
  '0xc8dc2ec5f5e02be8b37a8444a1931f02374a17ab'.toLowerCase();

export const AUGUSTUS_V5_ADDRESS = '0xdef171fe48cf0115b1d80b88dc8eab59176fee57';

export const BalancerVaultAddress =
  '0xba12222222228d8ba445958a75a0704d566bf2c8';
export const Balancer_80PSP_20WETH_poolId =
  '0xcb0e14e96f2cefa8550ad8e4aea344f211e5061d00020000000000000000011a';
export const Balancer_80PSP_20WETH_address =
  Balancer_80PSP_20WETH_poolId.substring(0, 42); // or 0xcb0e14e96f2cefa8550ad8e4aea344f211e5061d
