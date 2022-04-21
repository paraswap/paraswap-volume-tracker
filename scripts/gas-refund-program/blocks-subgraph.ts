import { SUBGRAPH_URL } from '../../src/lib/block-info';
import { thegraphClient } from './data-providers-clients';

const query = `query ($time_gte: BigInt) {
      blocks(first: 1, orderBy: timestamp, orderDirection: asc, where: {timestamp_gte: $time_gte}) {
        number
      }
    }`;

export async function getBlockAfterTimeStamp(
  chainId: number,
  timestamp: number,
): Promise<number> {
  // fetch the block info
  const variables = {
    time_gte: timestamp,
  };

  const { data } = await thegraphClient.post<{
    data: { blocks: [{ number: string }] };
  }>(SUBGRAPH_URL[chainId], { query, variables });

  if (typeof data.data?.blocks?.[0]?.number !== 'string') {
    throw new Error(
      `blockNumber could be retrieved for timestamp ${timestamp} (blocks-subraph out of sync)`,
    );
  }

  return parseInt(data.data.blocks[0].number);
}
