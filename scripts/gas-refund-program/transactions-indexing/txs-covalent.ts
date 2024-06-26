import { assert } from 'ts-essentials';
import {
  CovalentTransactionV3,
  getBulkTimeBucketTxsWithinInterval,
} from '../../../src/lib/utils/covalent';
import { covalentClient } from '../../../src/lib/utils/data-providers-clients';
import { CHAIN_ID_OPTIMISM } from '../../../src/lib/constants';
import {
  CovalentTransaction,
  CovalentAPI,
  ExtendedCovalentGasRefundTransaction,
} from '../../../src/types-from-scripts';

interface GetContractTXsByNetworkInput {
  chainId: number;
  contract: string;
  startTimestamp: number;
  endTimestamp: number;
}

// DEPRECATED does not work anymore, throws error: Time bound query parameters are deprecated. Please refer to https://www.covalenthq.com/docs/api/transactions/get-time-bucket-transactions-for-address-v3/.
export const covalentGetTXsForContract = async ({
  startTimestamp,
  endTimestamp,
  chainId,
  contract,
}: GetContractTXsByNetworkInput): Promise<CovalentTransaction[]> => {
  throw new Error('DEPRECATED');
  const covalentAddressToTransaction = (
    txCov: CovalentAPI.Transaction,
  ): ExtendedCovalentGasRefundTransaction => ({
    txHash: txCov.tx_hash,
    txOrigin: txCov.from_address,
    txGasPrice: txCov.gas_price.toString(),
    txGasUsed: txCov.gas_spent.toString(),
    blockNumber: txCov.block_height.toString(),
    // convert time to unixtime (seconds)
    timestamp: (new Date(txCov.block_signed_at).getTime() / 1000).toString(),
    contract,
  });

  const { COVALENT_API_KEY } = process.env;
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

    // pagination params (page-size, block-signed-at-limit, block-signed-at-span) don't play nice alltogether
    // specifically for sePSP2 as the nb of total txs was > page-size=1000 this broke.
    return `/${chainId}/address/${contract}/transactions_v2/?key=${COVALENT_API_KEY}&no-logs=true&page-number=${page}&page-size=5000&block-signed-at-limit=${startSecondsAgo}&block-signed-at-span=${duration}&match={"to_address": "${contract}"}`;
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

  const filteredItems = items
    // ensure we only return those within the specified range and not those included in the safety margin
    .filter(
      tx => +tx.timestamp >= startTimestamp && +tx.timestamp <= endTimestamp,
    );

  return filteredItems;
};

export const covalentGetTXsForContractV3 = async ({
  startTimestamp,
  endTimestamp,
  chainId,
  contract,
}: GetContractTXsByNetworkInput): Promise<
  ExtendedCovalentGasRefundTransaction[]
> => {
  assert(
    contract.toLowerCase() === contract,
    'contract address should be lower cased',
  );

  const covalentAddressToTransaction = (
    txCov: CovalentTransactionV3,
  ): ExtendedCovalentGasRefundTransaction => {
    const {
      tx_hash: txHash,
      from_address: txOrigin,
      gas_price: _txGasPrice,
      gas_spent: txGasUsed,
      block_height: blockNumber,
      block_signed_at: blockTimestamp,
      fees_paid: feesPaidInChainCurrency,
    } = txCov;

    const timestamp = (new Date(blockTimestamp).getTime() / 1000).toString(); // convert time to unixtime (seconds)

    const txGasPrice =
      chainId !== CHAIN_ID_OPTIMISM
        ? _txGasPrice.toString()
        : (BigInt(feesPaidInChainCurrency) / BigInt(txGasUsed)).toString(); // virtually scaling gasPrice up for optimism to take into account for L1 tx fees submission (dirty fix, shouldn't cause too much troubles)

    return {
      txHash,
      txOrigin,
      txGasPrice,
      txGasUsed: txGasUsed.toString(),
      blockNumber: blockNumber.toString(),
      timestamp,
      contract,
    };
  };

  const allTxs = await getBulkTimeBucketTxsWithinInterval({
    account: contract,
    startTimestamp,
    endTimestamp,
    chainId,
  });

  // to_address can be null for contract creation that emits an event containing contarct address like https://etherscan.io/tx/0x938502217dc02b4bb8cd42a85a1995703c0173a6196e9ecdf8f1310a13842645
  const rawTxs = allTxs.filter(t => t.to_address?.toLowerCase() === contract);

  const txs = rawTxs.map(covalentAddressToTransaction);

  const filteredTxs = txs
    // ensure we only return those within the specified range and not those included in the safety margin
    .filter(
      tx => +tx.timestamp >= startTimestamp && +tx.timestamp <= endTimestamp,
    );

  return filteredTxs;
};
