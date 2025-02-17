export const CHAIN_ID_MAINNET = 1;
export const CHAIN_ID_OPTIMISM = 10;
export const CHAIN_ID_ROPSTEN = 3;
export const CHAIN_ID_GOERLI = 5;
export const CHAIN_ID_BINANCE = 56;
export const CHAIN_ID_POLYGON = 137;
export const CHAIN_ID_AVALANCHE = 43114;
export const CHAIN_ID_FANTOM = 250;
export const CHAIN_ID_BASE = 8453;

export const PSP_ADDRESS: { [chainId: number]: string } = {
  [CHAIN_ID_MAINNET]: '0xcafe001067cdef266afb7eb5a286dcfd277f3de5',
  [CHAIN_ID_OPTIMISM]: '0xd3594e879b358f430e20f82bea61e83562d49d48',
  [CHAIN_ID_GOERLI]: '0xd8744453f3f5f64362FB6C52eadD0250Be4f45b2',
  [CHAIN_ID_BINANCE]: '0xcafe001067cdef266afb7eb5a286dcfd277f3de5',
  [CHAIN_ID_FANTOM]: '0xcafe001067cdef266afb7eb5a286dcfd277f3de5',
  [CHAIN_ID_POLYGON]: '0x42d61d766b85431666b39b89c43011f24451bff6',
};

export const XYZ_ADDRESS: { [chainId: number]: string } = {  
  [CHAIN_ID_OPTIMISM]: '0xE0B197133ec7E2Db9Cb574B1e3da21b93F6e3CbF'.toLowerCase(),
  [CHAIN_ID_BASE]: '0xBe68bd4a8D4977Eee7b87775411877d73Fc8cdF3'.toLowerCase(),
};


export const STAKING_CHAIN_IDS = [CHAIN_ID_MAINNET, CHAIN_ID_OPTIMISM];
export const ETH_NETWORKS = [CHAIN_ID_MAINNET, CHAIN_ID_GOERLI];
export const STAKING_CHAIN_IDS_SET = new Set(STAKING_CHAIN_IDS);

export const CHAINS_WITHOUT_PARASWAP_POOLS_SUPPORT = [CHAIN_ID_OPTIMISM];

export const VOLUME_TRACKER_SUPPORTED_NETWORKS = [CHAIN_ID_MAINNET];
export const VOLUME_TRACKER_INIT_TIME: { [network: number]: number } = {
  [CHAIN_ID_MAINNET]: parseInt(process.env.INIT_TIME || '0'), //TODO: use the block info to the init time from the init block
};

export const Web3Provider: { [network: number]: string } = {
  [CHAIN_ID_MAINNET]: process.env.HTTP_PROVIDER || '',
  //[CHAIN_ID_ROPSTEN]: process.env.HTTP_PROVIDER_3 || '',
  [CHAIN_ID_GOERLI]:
    process.env.HTTP_PROVIDER_5 || 'https://rpc.ankr.com/eth_goerli',
  [CHAIN_ID_OPTIMISM]: process.env.HTTP_PROVIDER_10 || '',
  [CHAIN_ID_BINANCE]: process.env.HTTP_PROVIDER_56 || '',
  [CHAIN_ID_POLYGON]: process.env.HTTP_PROVIDER_137 || '',
  [CHAIN_ID_FANTOM]: process.env.HTTP_PROVIDER_250 || '',
  [CHAIN_ID_AVALANCHE]: process.env.HTTP_PROVIDER_43114 || '',
  [CHAIN_ID_BASE]: process.env.HTTP_PROVIDER_8453 || '',
};

// TODO: in future we can fetch it from the api directly
export const AugustusV5Address: { [network: number]: string } = {
  [CHAIN_ID_MAINNET]: '0xdef171fe48cf0115b1d80b88dc8eab59176fee57',
  [CHAIN_ID_OPTIMISM]: '0xdef171fe48cf0115b1d80b88dc8eab59176fee57',
  [CHAIN_ID_BINANCE]: '0xdef171fe48cf0115b1d80b88dc8eab59176fee57',
  [CHAIN_ID_POLYGON]: '0xdef171fe48cf0115b1d80b88dc8eab59176fee57',
  [CHAIN_ID_FANTOM]: '0xdef171fe48cf0115b1d80b88dc8eab59176fee57',
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
  [CHAIN_ID_OPTIMISM]: '0xf9ae5216c5b7096d32bbb114be0c0497ff6fd9cb',
  [CHAIN_ID_GOERLI]: '0xc665bfd44e9382d05c1fa31e426162e5cbe824a2',
  [CHAIN_ID_ROPSTEN]: '0x293405FE3aDefDB94A8A1Ed50873a15C6Cc83BC5',
  [CHAIN_ID_BINANCE]: '0xdc6e2b14260f972ad4e5a31c68294fba7e720701',
  [CHAIN_ID_POLYGON]: '0xdC6E2b14260F972ad4e5a31c68294Fba7E720701',
  [CHAIN_ID_FANTOM]: '0xdC6E2b14260F972ad4e5a31c68294Fba7E720701',
  // [CHAIN_ID_BASE]: '0xa82a514bcdc7921f004b087611327aa80bc0fcd9', -- on base multical v 1 is buggy :shrug:
};

export const MULTICALL_ADDRESS_V3: Record<number,string> = {
  [CHAIN_ID_BASE]: '0xcA11bde05977b3631167028862bE2a173976CA11',
  [CHAIN_ID_OPTIMISM]: '0xcA11bde05977b3631167028862bE2a173976CA11',
}

export type MulticallEncodedData = { returnData: string[] };

export const DEFAULT_CHAIN_ID = parseInt(process.env.DEFAULT_CHAIN_ID || '1');

export const NULL_ADDRESS = '0x0000000000000000000000000000000000000000';

export const NATIVE_TOKEN_ADDRESS =
  '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

export const SAFETY_MODULE_ADDRESS =
  '0xc8dc2ec5f5e02be8b37a8444a1931f02374a17ab'.toLowerCase();

//All these must be lower-cased!
export const AUGUSTUS_V5_ADDRESS = '0xdef171fe48cf0115b1d80b88dc8eab59176fee57';
export const AUGUSTUS_V6_0_ADDRESS = '0x00000000fdac7708d0d360bddc1bc7d097f47439'; 
export const AUGUSTUS_V6_1_ADDRESS = '0x000db803a70511e09da650d4c0506d0000100000';
export const AUGUSTUS_V6_2_ADDRESS = '0x6a000f20005980200259b80c5102003040001068';

export const AUGUSTUS_SWAPPERS_V6_OMNICHAIN = new Set([
  AUGUSTUS_V6_0_ADDRESS,
  AUGUSTUS_V6_1_ADDRESS,
  AUGUSTUS_V6_2_ADDRESS
])

export const BalancerVaultAddress =
  '0xba12222222228d8ba445958a75a0704d566bf2c8';

export const Balancer_80PSP_20WETH_poolId: { [chainId: string]: string } = {
  [CHAIN_ID_MAINNET]:
    '0xcb0e14e96f2cefa8550ad8e4aea344f211e5061d00020000000000000000011a',
  [CHAIN_ID_GOERLI]:
    '0xdedb0a5abc452164fd241da019741026f6efdc74000200000000000000000223',
  [CHAIN_ID_OPTIMISM]:
    '0x11f0b5cca01b0f0a9fe6265ad6e8ee3419c684400002000000000000000000d4',
};

export const Balancer_80PSP_20WETH_address = Object.fromEntries(
  Object.entries(Balancer_80PSP_20WETH_poolId).map(([chainId, poolId]) => [
    chainId,
    poolId.substring(0, 42),
  ]),
);



// TODO put correct (non test) values here
export const Balancer_80XYZ_20WETH_poolId: { [chainId: string]: string } = {
  [CHAIN_ID_BASE]:
    '0xf80c528ecf45efefff5e4bc6d9f11ed1f6e5f09d0002000000000000000001bd',  
  [CHAIN_ID_OPTIMISM]:
    '0xbe8dda0753ef6992a28759282585209c98c25de2000200000000000000000161',
};

export const Balancer_80XYZ_20WETH_address = Object.fromEntries(
  Object.entries(Balancer_80XYZ_20WETH_poolId).map(([chainId, poolId]) => [
    chainId,
    poolId.substring(0, 42),
  ]),
);
