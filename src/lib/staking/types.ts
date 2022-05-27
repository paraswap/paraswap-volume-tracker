export type DataByPool<T> = {
  [poolAddress: string]: T;
};

export type DataByAccount<T> = {
  [accountAddress: string]: T;
};

export type DataByAccountByPool<T> = {
  [poolAddress: string]: {
    [accountAddress: string]: T;
  };
};

export type PSPStakesForStaker<T> = {
  totalPSPStaked: T;
  descr: {
    totalPSPStakedInSPSP: T;
    totalPSPStakedInSafetyModule: T;
  };
};

export type PSPStakesAllStakers<T> = {
  [accountAddress: string]: {
    pspStaked: T;
    breakdownByStakingContract: { [contractAddress: string]: string };
  };
};

export type SPSPStakesByAccount<T> = {
  [accountAddress: string]: {
    totalPSPStakedAllSPSPS: T;
    descr: {
      totalPSPStakedBySPSP: DataByPool<T>;
    };
  };
};

export type StkPSPBPtState<T> = {
  stkPSPBPtTotalSupply: T;
  bptBalanceOfStkPSPBpt: T;
  bptTotalSupply: T;
  pspBalance: T;
};
