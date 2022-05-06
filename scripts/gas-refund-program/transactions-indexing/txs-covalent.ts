import { covalentClient } from '../data-providers-clients';
import { CovalentAPI, CovalentTransaction } from '../types';
import { queryPaginatedData, QueryPaginatedDataParams } from '../utils';


interface GetContractTXsByNetworkInput {
  chainId: number;
  contract: string;
  startTimestamp: number;
  endTimestamp: number;
}

export const covalentGetTXsForContract = async ({
  startTimestamp,
  endTimestamp,
  chainId,
  contract
}: GetContractTXsByNetworkInput): Promise<CovalentTransaction[]> => {

  const covalentAddressToTransaction = (txCov: CovalentAPI.Transaction): CovalentTransaction => ({
    txHash: txCov.tx_hash,
    txOrigin: txCov.from_address,
    txGasPrice: txCov.gas_price.toString(),
    txGasUsed: txCov.gas_spent.toString(),
    blockNumber: txCov.block_height,
    // convert time to unixtime (seconds)
    timestamp: (new Date(txCov.block_signed_at).getTime() / 1000).toString(),
  })

  // filter out smart contract wallets
  const filterTXs = (txCov: CovalentAPI.Transaction): boolean =>txCov.to_address?.toLowerCase() === contract.toLowerCase();


  const { COVALENT_API_KEY } = process.env;

  // todo: better would be to first call the end point with page-size=0 just to get the total number of items, and then construct many request promises and run concurrently - currently this isn't possible (as `total_count` is null) in the covalent api but scheduled
  const fetchTXs = async({ pageNumber }: QueryPaginatedDataParams): Promise<CovalentTransaction[]> => {

    // safety margin to counter possible edge case of relative - not absolute - range bounds
    const safeMarginForRequestLimits = 10;
    const startSecondsAgo = Math.floor((new Date().getTime()) / 1000) - startTimestamp + safeMarginForRequestLimits;
    const duration = (endTimestamp - startTimestamp) + safeMarginForRequestLimits;
    /**
     * NOTE: for this to work, we must only query historic data.
     * if start limit + duration is not less than now, we'll get
     * live data which may change across paginations since it is
     * still forming.
     */
    if (endTimestamp > Date.now()) {
      throw new Error('only query historic data');
    }

    const route = `/${chainId}/address/${contract}/transactions_v2/?key=${COVALENT_API_KEY}&no-logs=true&page-number=${pageNumber}&page-size=1000&block-signed-at-limit=${startSecondsAgo}&block-signed-at-span=${duration}`;

    const { data } = await covalentClient.get(route);

    return data.data.items.filter(filterTXs).map(covalentAddressToTransaction);
  };

  const items = await queryPaginatedData(fetchTXs);

  return items
    // ensure we only return those within the specified range and not those included in the safety margin
    .filter(tx => +tx.timestamp >= startTimestamp && +tx.timestamp <= endTimestamp);
}
