import BigNumber from 'bignumber.js';

export type StakesFetcher = ({
  account,
  blockNumber,
  chainId,
}: {
  account: string;
  blockNumber: number;
  chainId: number;
}) => Promise<BigNumber>;
