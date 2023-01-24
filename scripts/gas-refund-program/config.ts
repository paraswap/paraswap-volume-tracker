import { identity } from 'lodash';
import { CHAIN_ID_GOERLI, CHAIN_ID_MAINNET } from '../../src/lib/constants';
import {
  GasRefundV2EpochFlip,
  isMainnetStaking,
} from '../../src/lib/gas-refund';

type GRPV2GlobalConfig = {
  startEpochTimestamp: number;
  epochDuration: number;
  lastEpochForSePSP2MigrationRefund: number;
  sePSP2PowerMultiplier: number;
};

export const grp2GlobalConfig: GRPV2GlobalConfig = {
  startEpochTimestamp: 1673305200, // FIXME for testing
  epochDuration: 4 * 7 * 24 * 60 * 60,
  lastEpochForSePSP2MigrationRefund: GasRefundV2EpochFlip + 1, // first 2 epochs inclusive
  sePSP2PowerMultiplier: 2.5,
};

type GRPV2ConfigByChain = {
  sePSP1: string;
  sePSP2: string;
  bpt: string;
  poolId: string;
  migrator: string;
};

const l = (s: string) => s.toLowerCase();

export const grp2ConfigByChain: {
  [chainId: number]: GRPV2ConfigByChain;
} = {
  [CHAIN_ID_MAINNET]: {
    sePSP1: l('0x716fbc68e0c761684d9280484243ff094cc5ffab'),
    sePSP2: l('0x593f39a4ba26a9c8ed2128ac95d109e8e403c485'),
    bpt: l('0xCB0e14e96f2cEFA8550ad8e4aeA344F211E5061d'),
    poolId: l(
      '0xcb0e14e96f2cefa8550ad8e4aea344f211e5061d00020000000000000000011a',
    ),
    migrator: l('0x81DF863E89429B0d4230a2A922DE4f37f718EED3'),
  },
  [CHAIN_ID_GOERLI]: {
    sePSP1: l('0xFef5392ac7cE391dD63838a73E6506F9948A9Afa'),
    sePSP2: l('0x2e445Be127FC9d406dC4eD3E320B0f5A020cb4A0'),
    bpt: l('0xdedB0a5aBC452164Fd241dA019741026f6EFdC74'),
    poolId: l(
      '0xdedb0a5abc452164fd241da019741026f6efdc74000200000000000000000223',
    ),
    migrator: l('0x8580D057198E80ddE65522180fd8edBeA67D61E6'),
  },
};

const twistChains = (chain1: number, chain2: number) => (chainId: number) =>
  chainId === chain1 ? chain2 : chain2;

type ChainTwister = (chainId: number) => number;
export const forceStakingChainId: ChainTwister = !isMainnetStaking
  ? twistChains(CHAIN_ID_MAINNET, CHAIN_ID_GOERLI)
  : identity;
export const forceEthereumMainnet: ChainTwister = !isMainnetStaking
  ? twistChains(CHAIN_ID_GOERLI, CHAIN_ID_MAINNET)
  : identity;
