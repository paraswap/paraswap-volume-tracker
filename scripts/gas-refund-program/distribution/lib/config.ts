type ConfigSlice = {
  govCoMs: string;
  sePSP1: string;
  erc20BalanceProbeChecker: string;
};
export const config: { [chainId: number | number]: ConfigSlice } = {
  1: {
    govCoMs: '0x619BBf92Fd6bA59893327676B2685A3762a49a33',
    sePSP1: '0x716fBC68E0c761684D9280484243FF094CC5FfAB',
    erc20BalanceProbeChecker: '0x6904a375520a9d2a3e9ce781ed6cac0eb07e8fa7',
  },
  10: {
    govCoMs: '0xf93A7F819F83DBfDbC307d4D4f0FE5a208C50318',
    sePSP1: '0x8C934b7dBc782568d14ceaBbEAeDF37cB6348615',
    erc20BalanceProbeChecker: '0xe37ea254c9486031e1e4ed4a55caf068584ccd1b',
  },
};
