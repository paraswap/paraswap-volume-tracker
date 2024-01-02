const PinataClient = require('@pinata/sdk');
export async function persistDirectoryToPinata(directoryPath: string) {
  const pinata = new PinataClient({
    pinataApiKey: process.env.PINATA_API_KEY,
    pinataSecretApiKey: process.env.PINATE_API_SECRET,
  });

  const { IpfsHash } = await pinata.pinFromFS(directoryPath);
  return IpfsHash;
}
