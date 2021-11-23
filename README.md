# ParaSwap Volume Tracker

For more questions and be involved:
- Join our Discord http://paraswap.io/discord
- Participate on our DAO https://snapshot.org/#/paraswap-dao.eth

### Description:

This service calculates most of the analytics that is displayed on the ParaSwap Staking UI. This service also calculates the Market Maker rewards that are distributed every epoch. The service works by continuously polling all the 0x events where ParaSwap contracts are the taker addresses and indexing them in the PostgreSQL database.

### Run the server:
- Install Docker
- run:
```bash
docker-compose up
```

### Endpoints:

`/staking/volume`: returns the volumes of all active market makers

`/staking/pools`: returns ParaSwapPool staking data

`/staking/pools`: returns ParaSwapPool staking data

`/airdrop/claim/:address`: return airdrop claim data
