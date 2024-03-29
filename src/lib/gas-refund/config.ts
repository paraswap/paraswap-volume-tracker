import { identity } from 'lodash';
import {
  CHAIN_ID_GOERLI,
  CHAIN_ID_MAINNET,
  CHAIN_ID_OPTIMISM,
} from '../constants';
import { GasRefundV2EpochFlip, isMainnetStaking } from './gas-refund';

type GRPV2GlobalConfig = {
  startEpochTimestamp: number;
  epochDuration: number;
  lastEpochForSePSP2MigrationRefund: number;
  sePSP2PowerMultiplier: number;
};

export const grp2GlobalConfig: GRPV2GlobalConfig = {
  startEpochTimestamp: 1674475200,
  epochDuration: 4 * 7 * 24 * 60 * 60,
  lastEpochForSePSP2MigrationRefund: GasRefundV2EpochFlip + 1, // first 2 epochs inclusive
  sePSP2PowerMultiplier: 2.5,
};

type GRP2ConfigByChain = {
  stakingStartCalcTimestamp?: number; // the timestamp of staking enabling for a particular chain
};

export const grp2CConfigParticularities: {
  [network: number]: GRP2ConfigByChain;
} = {
  [CHAIN_ID_GOERLI]: {},
  [CHAIN_ID_MAINNET]: {},
  [CHAIN_ID_OPTIMISM]: {
    stakingStartCalcTimestamp: 1691409600,
  },
};

type GRPV2ConfigByChain = {
  sePSP1: string;
  sePSP2: string;
  bpt: string;
  poolId: string;
  psp1ToPsp2Migrator?: string;
  sePSP1ToSePSP2Migrator: string;
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
    psp1ToPsp2Migrator: l('0x81DF863E89429B0d4230a2A922DE4f37f718EED3'),
    sePSP1ToSePSP2Migrator: l('0xf6ef5292b8157c2e604363f92d0f1d176e0dc1be'),
  },
  [CHAIN_ID_GOERLI]: {
    sePSP1: l('0xFef5392ac7cE391dD63838a73E6506F9948A9Afa'),
    sePSP2: l('0x2e445Be127FC9d406dC4eD3E320B0f5A020cb4A0'),
    bpt: l('0xdedB0a5aBC452164Fd241dA019741026f6EFdC74'),
    poolId: l(
      '0xdedb0a5abc452164fd241da019741026f6efdc74000200000000000000000223',
    ),
    psp1ToPsp2Migrator: l('0x8580D057198E80ddE65522180fd8edBeA67D61E6'),
    sePSP1ToSePSP2Migrator: '0x',
  },
  [CHAIN_ID_OPTIMISM]: {
    sePSP1: l('0x8C934b7dBc782568d14ceaBbEAeDF37cB6348615'),
    sePSP2: l('0x26Ee65874f5DbEfa629EB103E7BbB2DEAF4fB2c8'),
    bpt: l('0x11f0b5cca01b0f0a9fe6265ad6e8ee3419c68440'),
    poolId: l(
      '0x11f0b5cca01b0f0a9fe6265ad6e8ee3419c684400002000000000000000000d4',
    ),
    sePSP1ToSePSP2Migrator: l('0x18e1A8431Ce39cBFe95958207dA2d68A7Ef8C583'),
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
