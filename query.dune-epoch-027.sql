yarn run v1.22.22
$ patch-package && NODE_ENV=development ts-node scripts/gas-refund-program/generate-dune-query
patch-package 6.4.7
Applying patches...
sequelize@6.8.0 ✔
________________________________________________
-- This is a generated query. Don't modify it manually, as it'll get overwritten by script

  
  
  
  with
  hardcoded_stakers AS (
    SELECT
      staker
    from
    --4129573 -- epoch 020-51
    -- 4131968 -- epoch 021-52
    -- 4221428 -- epoch 022-53
    -- 4343275 -- epoch 023-54
    -- 4472438 -- epoch 024-55
    -- 4609884 -- epoch 025-56
    -- 4733819 -- epoch 026-57
    -- 4874618 -- epoch 027-58
      query_4874618      
  ),  
       
  
     transactionsInvolvingContracts_ethereum as (
       select     
        1 as chainId,         
         to as contract,            
         "from", cast(transactions."gas_price" as varchar) as "gas_price", hash, cast(transactions."to" as varchar) as "to", block_number, block_time, cast(transactions."gas_used" as varchar) as "gas_used", 0 as "l1_fee", cast(transactions."success" as varchar) as "success"
       from
         ethereum.transactions
       where
        block_time >= to_timestamp('2025-02-17 12:00:00', 'yyyy-mm-dd hh24:mi:ss')
         and block_time <= to_timestamp('2025-03-17 12:00:00', 'yyyy-mm-dd hh24:mi:ss')         
         and to in (0x716fbc68e0c761684d9280484243ff094cc5ffab,0x593f39a4ba26a9c8ed2128ac95d109e8e403c485,0xf6ef5292b8157c2e604363f92d0f1d176e0dc1be,0x00000000fdac7708d0d360bddc1bc7d097f47439,0x000db803a70511e09da650d4c0506d0000100000,0x6a000f20005980200259b80c5102003040001068)
         and "from" in (select staker from hardcoded_stakers)       
         and transactions.success = true
     ) SELECT * from (
(select * from transactionsInvolvingContracts_ethereum)) ORDER BY block_time DESC
  
  
________________________________________________
Use the above output here https://dune.com/queries
script finished undefined
Done in 2.33s.
