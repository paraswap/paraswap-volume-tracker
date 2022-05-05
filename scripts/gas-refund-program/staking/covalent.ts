import { assert } from 'ts-essentials';
import { URLSearchParams } from 'url';
import { covalentClient } from '../data-providers-clients';
import { queryPaginatedData, QueryPaginatedDataParams } from '../utils';

const COVALENT_API_KEY = process.env.COVALENT_API_KEY || 'ckey_docs'; // public, is rate-limited

interface TokenHoldersOptions {
  token: string;
  chainId: number;
  blockHeight?: string;
}

export async function getTokenHolders({
  token,
  chainId,
  blockHeight,
}: TokenHoldersOptions): Promise<TokensHoldersData['items']> {
  const fetchTokenHolders = async ({
    pageNumber,
    pageSize,
  }: QueryPaginatedDataParams) => {
    const queryString = makeQueryStr({
      'block-height': blockHeight,
      'page-number': pageNumber.toString(),
      'page-size': pageSize.toString(),
    });

    const url = `/${chainId}/tokens/${token}/token_holders/?key=${COVALENT_API_KEY}${
      queryString ? '&' + queryString : ''
    }`;

    const { data } = await covalentClient.get<TokensHoldersResponse>(url);

    return data.data.items;
  };

  const tokenHolders = await queryPaginatedData(fetchTokenHolders, 10_000);

  return tokenHolders;
}

interface TransactionQueryOptions {
  chainId: number;
  txHash: string;
}

interface TransactionResponse {
  data: {
    items: [
      {
        gas_spent: number;
      },
    ];
  };
}

export async function getTransactionGasUsed({
  chainId,
  txHash,
}: TransactionQueryOptions): Promise<number> {
  const url = `/${chainId}/transaction_v2/${txHash}/?key=${COVALENT_API_KEY}`;

  const { data } = await covalentClient.get<TransactionResponse>(url);

  assert(data.data.items.length === 1, 'Expected exactly one transaction');
  const gasUsed = data.data.items[0].gas_spent;
  assert(gasUsed > 0, 'Expected transaction to non zero gas_spent');

  return gasUsed;
}

interface TokensHoldersResponse {
  data: TokensHoldersData;
  error: false;
  error_message: null;
  error_code: null;
}

interface TokensHoldersData {
  updated_at: string; // date-time
  items: TokenItem[];
  pagination: Pagination | null;
}
interface Pagination {
  has_more: boolean;
  total_count: number;
  // use this together when paginating
  page_number: number; // use ?page-number=
  page_size: number; // use ?page-size=
  // @WARNING pagination doesn't seem to work, try page-number=2&page-size=2, get items=[]
}

interface ErrorResponse {
  data: null;
  error: true;
  error_message: string; // e.g. "backend queue is full and cannot accept request"
  error_code: number; // e.g. 507
}

interface TokenItem {
  contract_decimals: number;
  contract_name: string;
  contract_ticker_symbol: string;
  contract_address: string; // lowercase, 0xeee... for NativeTokens except for Matic
  supports_erc: string[] | null; // e.g. ["erc20", "erc721", "erc1155"] for known Tokens, null for Native Token, except on Polygon, for sPSP = null
  logo_url: string;
  last_transferred_at: string; // date-time
  address: string; // lowercase, holder address
  balance: string; // wei
  total_supply: string; // wei
  block_height: number;
}

function makeQueryStr(mapping: Record<string, string | undefined>): string {
  const entries = Object.entries(mapping).filter(
    (entry): entry is [string, string] => !!entry[1],
  );

  const url = new URLSearchParams(entries);

  return url.toString();
}
