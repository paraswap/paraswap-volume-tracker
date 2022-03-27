import { URLSearchParams } from 'url';
import { Utils } from '../../../lib/utils';

const COVALENT_API_KEY = process.env.COVALENT_API_KEY || 'ckey_docs'; // public, is rate-limited

interface TokenHoldersOptions {
  token: string;
  chainId: number;
  blockHeight?: string;
  pageNumber?: number;
  pageSize?: number;
}

export async function getTokenHolders({
  token,
  chainId,
  blockHeight,
  pageNumber,
  pageSize,
}: TokenHoldersOptions): Promise<TokensHoldersData> {
  const queryString = makeQueryStr({
    'block-height': blockHeight,
    'page-number': pageNumber?.toString(),
    'page-size': pageSize?.toString(),
  });

  const url = `https://api.covalenthq.com/v1/${chainId}/tokens/${token}/token_holders/?key=${COVALENT_API_KEY}${
    queryString ? '&' + queryString : ''
  }`;

  const { data } = await Utils._get<TokensHoldersResponse>(url, 2000); // times out otherwise

  return data.data;
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
