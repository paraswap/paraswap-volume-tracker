const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgres://paraswap:paraswap@127.0.0.1:32780/volume_tracker';

function parseDatabaseURI(uri) {
  // Use the URL constructor to parse the URI
  const parsedURI = new URL(uri);

  // Extract the relevant parts
  const protocol = parsedURI.protocol; // "postgres:"
  const username = parsedURI.username; // "paraswap"
  const password = parsedURI.password; // "paraswap"
  const hostname = parsedURI.hostname; // "127.0.0.1"
  const port = parsedURI.port; // "32780"
  const database = parsedURI.pathname.slice(1); // "volume_tracker" (remove the leading "/")

  // Return an object with the extracted details
  return {
    protocol,
    username,
    password,
    hostname,
    port,
    database,
  };
}

const parsed = parseDatabaseURI(DATABASE_URL);

module.exports = {
  development: {
    username: parsed.username,
    password: parsed.password,
    database: parsed.database,
    host: parsed.hostname,
    port: parsed.port,
    dialect: 'postgres',
  },
};
