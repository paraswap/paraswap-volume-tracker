# Gas Refund Program

## Requirements
- **HTTP_PROVIDER**: Archive Node on ethereum (HTTP_PROVIDER) to read historical PSP stakes
- **COVALENT_API_KEY**
- **DATABASE_URL**: Postgres local instance

Start local postgres:
`docker compose up -d` in src/ folder
or
`docker run --name volume-tracker-db -e POSTGRES_PASSWORD=paraswap -e POSTGRES_USER=paraswap -e POSTGRES_DB=volume_tracker -p 32780:5432 -d postgres` anywhere

## Description

- **computeGasRefund**: index transactions over one epoch and compute refund (`sum(gas * gasPrice * pspChainCurrencySameDayRate * refundPercent)` -> run automatically/periodically
- **computeMerkleTree**: compute merkle tree of all gas refunds and store in file/db -> 2 variants needed to seed contract upfront then allow users to actually claim read next section

## Run the scripts
Run
- `gas-refund:dev:compute-gas-refund-save-db`: index transactions over one epoch and compute gas refund -> soon run forever ? cron task ?

Then
- `gas-refund:compute-merkle-tree-save-file`: compute Merkle Trees for all supported chains and store in files -> this should run manually to help on inspecting data and ultimately update the contract with new Merkle Root and add funds by calling [seedAllocations()](https://github.com/balancer-labs/erc20-redeemable/blob/master/merkle/contracts/MerkleRedeem.sol#L124) [in futur can even trigger gnosis safe proposal]

Finally
- `gas-refund:compute-merkle-tree-save-db`: compute Merkle Trees for all supported chains and store in DB -> this should run manually after the contract has been updated with new merkle root and new funds [in futur can even be triggered on ~event dispatching~ seedAllocations() calls]

Warning: after this last command is executed in prod, users will be able to claim their refund for the epoch, so better seed contract first.

## Api endpoints
- `GET /gas-refund/describe?epoch=:epoch&network=:network`: debug endpoint to describe pending or completed epoch's refund data -> pick one eligible address and verify onchain (keep in mind PSP refunded is based on same date PSP/chain currency rate and user stakes).
- `GET /gas-refund/all-merkle-data/:network/:eligible_address`: returns total claimable amounts and merkle proofs of non claimed refunds to actually allow users to claim their refund -> data should match with debug endpoint