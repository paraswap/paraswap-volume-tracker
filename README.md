#### Volume Tracker

This service calculates most of the analytics that is displayed on the ParaSwap Staking UI. This service also calculates the Market Maker rewards that are distributed every epoch. The service works by continuously polling all the 0x events where ParaSwap contracts are the taker addresses and indexing them in the PostgreSQL database.

