type V2Params = {
  sePSP1: string;
  sePSP2: string;
  bpt: string;
  poolId: string;
  migrator: string;
};

// TODO
export const config: {
  [chainId: number]: V2Params;
} = {
  5: {
    sePSP1: '',
    sePSP2: '',
    bpt: '',
    poolId: '',
    migrator: '',
  },
};
