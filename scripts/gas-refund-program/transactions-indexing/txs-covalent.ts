import { configLoader } from '../../../src/config';
import { covalentClient } from '../../../src/lib/utils/data-providers-clients';
import {
  CovalentAPI,
  CovalentTransaction,
  GasRefundTransaction,
} from '../types';

const globalConfig = configLoader.getGlobalConfig();

interface GetContractTXsByNetworkInput {
  chainId: number
  contract: string;
  startTimestamp: number;
  endTimestamp: number;
}

export const covalentGetTXsForContract = async ({
  startTimestamp,
  endTimestamp,
  chainId,
  contract,
}: GetContractTXsByNetworkInput): Promise<CovalentTransaction[]> => {
  const covalentAddressToTransaction = (
    txCov: CovalentAPI.Transaction,
  ): GasRefundTransaction => ({
    txHash: txCov.tx_hash,
    txOrigin: txCov.from_address,
    txGasPrice: txCov.gas_price.toString(),
    txGasUsed: txCov.gas_spent.toString(),
    blockNumber: txCov.block_height.toString(),
    // convert time to unixtime (seconds)
    timestamp: (new Date(txCov.block_signed_at).getTime() / 1000).toString(),
    contract,
  });

  const path = (page: number) => {
    /* Covalent API only has time relative pagination for tx scanning (give me tx within last X seconds).
     * We take a safety margin to counter possible edge case of relative - not absolute - range bounds
     * specific edge case:
     *  given r_window = relative temporal window and g_window = absolute temporal window.
     *  When request queues up for couple of minutes due to local rate limitation,
     *  it can happen that we  miss some txs because we searched in r_window that is out of range (out of g_window range to be precise)
     *  In such case making r_window wider (here 2h, 1h before + 1h after) allows us to search txs in wider window without suffering from rate limiting lag.
     *  This is obviously brutforcing...
     */
    const safeMarginForRequestLimits = 60 * 60;
    const startSecondsAgo =
      Math.floor(new Date().getTime() / 1000) -
      startTimestamp +
      safeMarginForRequestLimits;
    const duration = endTimestamp - startTimestamp + safeMarginForRequestLimits;
    /**
     * NOTE: for this to work, we must only query historic data.
     * if start limit + duration is not less than now, we'll get
     * live data which may change across paginations since it is
     * still forming.
     */
    if (endTimestamp > Date.now()) {
      throw new Error('only query historic data');
    }

    return `/${chainId}/address/${contract}/transactions_v2/?key=${globalConfig.covalentV1ApiKey}&no-logs=true&page-number=${page}&page-size=1000&block-signed-at-limit=${startSecondsAgo}&block-signed-at-span=${duration}&match={"to_address": "${contract}"}`;
  };

  // todo: better would be to first call the end point with page-size=0 just to get the total number of items, and then construct many request promises and run concurrently - currently this isn't possible (as `total_count` is null) in the covalent api but scheduled
  let hasMore = true;
  let page = 0;
  let items: CovalentTransaction[] = [];

  while (hasMore) {
    // request query params should be calculated for each request (since time relative)
    const route = path(page);

    const { data } = await covalentClient.get(route);

    const {
      data: {
        pagination: { has_more },
        items: receivedItems,
      },
    } = data;

    hasMore = has_more;
    page++;

    items = [...items, ...receivedItems.map(covalentAddressToTransaction)];
  }

  return (
    items
      // ensure we only return those within the specified range and not those included in the safety margin
      .filter(
        tx => +tx.timestamp >= startTimestamp && +tx.timestamp <= endTimestamp,
      )
  );
};
