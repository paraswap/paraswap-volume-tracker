import { TransactionRequest } from '@ethersproject/providers';
import { TenderlySimulation } from './TenderlySimulation';

type Simulation = {
  simulationUrls: string[];
  forkUrl: string;
  publicForkUrl: string;
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
    forkUrl: ts.forkUrl,
    publicForkUrl: ts.publicForkUrl,
  };
};
