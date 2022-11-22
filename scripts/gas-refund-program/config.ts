import { CHAIN_ID_GOERLI } from '../../src/lib/constants';

type V2Params = {
  sePSP1: string;
  sePSP2: string;
  bpt: string;
  poolId: string;
  migrator: string;
};

const l = (s: string) => s.toLowerCase();

export const configByChain: {
  [chainId: number]: V2Params;
} = {
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
