import { TransactionRequest } from '@ethersproject/providers';
import { TenderlySimulation } from './TenderlySimulation';

const TENDERLY_ACCOUNT_ID = process.env.TENDERLY_ACCOUNT_ID;
const TENDERLY_PROJECT = process.env.TENDERLY_PROJECT;

type Simulation = {
  simulationUrls: string[];
  vnetUrl: string;
  publicVnetUrl: string;
};
export const simulateTxs = async (
  chainId: number,
  transactionRequests: TransactionRequest[],
  isPublic: boolean,
): Promise<Simulation> => {
  const ts = new TenderlySimulation(chainId);
  await ts.setup();

  const simulationUrls: string[] = [];

  for (const transactionRequest of transactionRequests) {
    const simulation = await ts.simulate(transactionRequest, isPublic);
    if (!simulation.success)
      throw new Error(
        `simulation failed for chainId=${chainId}, url=${simulation.tenderlyUrl}`,
      );

    simulationUrls.push(simulation.tenderlyUrl);
  }
  return {
    simulationUrls,
    vnetUrl:
      `https://dashboard.tenderly.co/${TENDERLY_ACCOUNT_ID}/${TENDERLY_PROJECT}/testnet/` +
      ts.vnetId,
    publicVnetUrl: `https://dashboard.tenderly.co/explorer/vnet/${ts.vnetPublicId}/transactions`,
  };
};
