const BASE_URL = `https://gateway-arbitrum.network.thegraph.com/api`;
const THE_GRAPH_API_KEY = process.env.THE_GRAPH_API_KEY;

if (!THE_GRAPH_API_KEY) {
  throw new Error('THE_GRAPH_API_KEY is not provided');
}

export function createSubgraphURL(subgraphId?: string) {
  if (!subgraphId) return '';

  return `${BASE_URL}/${THE_GRAPH_API_KEY}/subgraphs/id/${subgraphId}`;
}
