import * as express from 'express';
import { isAddress } from '@ethersproject/address';
import VolumeTracker from './lib/volume-tracker';
import { MarketMakerAddresses } from './lib/volume-tracker';
import { PoolInfo } from './lib/pool-info';
import { Claim } from './models/Claim';
import {
  DEFAULT_CHAIN_ID,
  STAKING_CHAIN_IDS_SET,
  CHAIN_ID_MAINNET,
  CHAINS_WITHOUT_PARASWAP_POOLS_SUPPORT,
} from './lib/constants';
import {
  GasRefundApi,
  loadLatestDistributedEpoch,
} from './lib/gas-refund/gas-refund-api';
import { EpochInfo } from './lib/epoch-info';
import {
  GRP_SUPPORTED_CHAINS,
  GRP_V2_SUPPORTED_CHAINS_STAKING,
} from './lib/gas-refund/gas-refund';
import { StakingService } from './lib/staking/staking';
import { assert } from 'ts-essentials';
import {
  computeAggregatedStakeChainDetails,
  loadTransactionWithByStakeChainData,
} from './lib/gas-refund/multi-staking-utils';
import { GasRefundDistribution } from './models/GasRefundDistribution';

const logger = global.LOGGER();

const router = express.Router({});

export default class Router {
  app: express.Express;

  configure(app: express.Express) {
    this.app = app;
    this.setRoutes();
  }

  private setRoutes() {
    this.app.use('/', this.setAPIRoutes());
  }

  private setAPIRoutes(): express.Router {
    router.get('/volume/:network?', async (req, res) => {
      try {
        const fromTime = req.query.fromTime
          ? parseInt(<string>req.query.fromTime)
          : undefined;
        const toTime = req.query.toTime
          ? parseInt(<string>req.query.toTime)
          : undefined;
        const network = parseInt(req.params.network || '1');
        const result = await VolumeTracker.getInstance(network).getVolumeUSD(
          fromTime,
          toTime,
        );
        res.json(result);
      } catch (e) {
        logger.error('VolumeTracker_Error', e);
        res.status(403).send({ error: 'VolumeTracker Error' });
      }
    });

    router.get('/volume/aggregation/:network?', async (req, res) => {
      try {
        const period = req.query.period || '30d';
        const network = parseInt(req.params.network || '1');
        res.json(
          await VolumeTracker.getInstance(network).getVolumeAggregationUSD(
            period as string,
          ),
        );
      } catch (e) {
        logger.error('VolumeTracker_Error', e);
        res.status(403).send({ error: 'VolumeTracker Error' });
      }
    });

    router.get('/pools/:network?', async (req, res) => {
      try {
        const network = Number(req.params.network || DEFAULT_CHAIN_ID);
        if (!STAKING_CHAIN_IDS_SET.has(network)) {
          return res
            .status(403)
            .send({ error: `Unsupported network: ${network}` });
        }
        const result = await PoolInfo.getInstance(network).getLatestPoolData();
        res.json(result);
      } catch (e) {
        logger.error(req.path, e);
        res.status(403).send({ error: 'VolumeTracker Error' });
      }
    });

    router.get('/pools/earning/:address/:network?', async (req, res) => {
      try {
        const network = Number(req.params.network || DEFAULT_CHAIN_ID);
        if (
          !STAKING_CHAIN_IDS_SET.has(network) ||
          CHAINS_WITHOUT_PARASWAP_POOLS_SUPPORT.includes(network)
        ) {
          return res
            .status(403)
            .send({ error: `Unsupported network: ${network}` });
        }
        const address = <string>req.params.address;
        if (!isAddress(address)) {
          return res.status(403).send({ error: `Invalid address: ${address}` });
        }
        const result = await PoolInfo.getInstance(network).fetchEarnedPSP(
          address,
        );
        res.json(result);
      } catch (e) {
        logger.error(req.path, e);
        res.status(403).send({ error: 'VolumeTracker Error' });
      }
    });

    router.get('/airdrop/claim/:user', async (req, res) => {
      try {
        const claim = await Claim.findByPk(req.params.user);
        res.json({
          user: req.params.user,
          claim: claim ? claim.claim : null,
        });
      } catch (e) {
        logger.error(req.path, e);
        res.status(403).send({ error: 'VolumeTracker Error' });
      }
    });

    router.get('/rewards/:network?', async (req, res) => {
      try {
        if (!req.query.epochEndTime)
          return res.status(403).send({ error: 'epochEndTime is required' });
        const epochEndTime = parseInt(<string>req.query.epochEndTime);
        const network = Number(req.params.network || DEFAULT_CHAIN_ID);
        if (
          !STAKING_CHAIN_IDS_SET.has(network) ||
          CHAINS_WITHOUT_PARASWAP_POOLS_SUPPORT.includes(network)
        ) {
          return res
            .status(403)
            .send({ error: `Unsupported network: ${network}` });
        }
        const result = await PoolInfo.getInstance(
          network,
        ).getCurrentEpochRewardParams(epochEndTime);
        res.json(result);
      } catch (e) {
        logger.error(req.path, e);
        res.status(403).send({ error: 'VolumeTracker Error' });
      }
    });

    router.get('/marketmaker/addresses', async (req, res) => {
      try {
        res.json(MarketMakerAddresses);
      } catch (e) {
        logger.error(req.path, e);
        res.status(403).send({ error: 'MarketMakerAddresses Error' });
      }
    });

    router.get('/stakes/:address', async (req, res) => {
      try {
        const address = req.params.address.toLowerCase();
        const blockNumber = !!req.query.blockNumber
          ? Number(req.query.blockNumber as string)
          : undefined;

        assert(
          !blockNumber || !isNaN(blockNumber),
          'blockNumber should be either undefined or a number',
        );
        const totalPSPStakedInAllStakingPrograms =
          await StakingService.getInstance().getPSPStakesAllPrograms(
            address,
            blockNumber,
          );

        return res.json(totalPSPStakedInAllStakingPrograms);
      } catch (e) {
        logger.error(req.path, e);
        return res
          .status(403)
          .send({ error: 'stakes could not be retrieved for user' });
      }
    });

    router.get('/stakes', async (req, res) => {
      try {
        const blockNumber = !!req.query.blockNumber
          ? Number(req.query.blockNumber as string)
          : undefined;

        assert(
          !blockNumber || !isNaN(blockNumber),
          'blockNumber should be either undefined or a number',
        );

        const stakers =
          await StakingService.getInstance().getAllPSPStakersAllPrograms(
            blockNumber,
          );

        return res.json(stakers);
      } catch (e) {
        logger.error(req.path, e);
        res.status(403).send({
          error: `Staking: could not retrieve stakers for blockNumber=${req.query.blockNumber}`,
        });
      }
    });

    router.get(
      '/gas-refund/last-epoch-merkle-root/:network',
      async (req, res) => {
        try {
          const network = Number(req.params.network);
          const gasRefundApi = GasRefundApi.getInstance(network);
          const epochInfo = EpochInfo.getInstance(CHAIN_ID_MAINNET);

          const currentEpochNum = await epochInfo.getCurrentEpoch();
          const lastEpochNum = currentEpochNum - 1;
          const gasRefundDataLastEpoch =
            await gasRefundApi.gasRefundDataForEpoch(lastEpochNum);

          return res.json(gasRefundDataLastEpoch);
        } catch (e) {
          logger.error(req.path, e);
          res.status(403).send({
            error: `GasRefundError: could not retrieve merkle root for last epoch`,
          });
        }
      },
    );

    // NB: this endpoint will return approximate amounts. They will differ from the ones in merkle tree
    router.get(
      '/gas-refund/by-network/:address/:epochFrom/:epochTo',
      async (req, res) => {
        const address = req.params.address.toLowerCase();
        const epochFrom = req.params.epochFrom
          ? parseInt(req.params.epochFrom)
          : undefined;
        const epochTo = req.params.epochTo
          ? parseInt(req.params.epochTo)
          : undefined;

        const showTransactions = req.query.showTransactions === 'true';

        if (!address)
          return res
            .status(400)
            .send({ error: `address param is required: ${address}` });

        if (!epochFrom || !epochTo)
          return res
            .status(400)
            .send({ error: `epochFrom and epochTo params are required` });

        try {
          const transactions = await loadTransactionWithByStakeChainData({
            address,
            epochFrom,
            epochTo,
          });

          const {
            claimableByEpochByChain,
            transactionsWithClaimableByEpoch,
            refundedByEpochByChain,
          } = computeAggregatedStakeChainDetails(transactions);

          const latestDistributedEpoch = await loadLatestDistributedEpoch();

          return res.json(
            showTransactions
              ? {
                  latestDistributedEpoch,
                  transactionsWithClaimableByEpoch,
                  claimableByEpochByChain,
                  refundedByEpochByChain,
                }
              : {
                  latestDistributedEpoch,
                  claimableByEpochByChain,
                  refundedByEpochByChain,
                },
          );
        } catch (e) {
          logger.error('something went wrong', e);
          return res.status(400).send({ error: `something went wrong` });
        }
      },
    );

    router.get(
      '/gas-refund/user-data/consolidated/:address',
      async (req, res) => {
        const address = req.params.address.toLowerCase();

        try {
          const byNetworkId = Object.fromEntries(
            await Promise.all(
              GRP_SUPPORTED_CHAINS.map(async network => {
                const gasRefundApi = GasRefundApi.getInstance(network);
                return [
                  network,
                  await gasRefundApi.getAllGasRefundDataForAddress(address),
                ];
              }),
            ),
          );

          return res.json(byNetworkId);
        } catch (e) {
          logger.error(req.path, e);
          res.status(403).send({
            error: `GasRefundError: could not retrieve merkle datas for ${address}`,
          });
        }
      },
    );

    router.get('/gas-refund/user-data/:network/:address', async (req, res) => {
      const address = req.params.address.toLowerCase();

      try {
        const network = Number(req.params.network);
        if (!GRP_SUPPORTED_CHAINS.includes(network))
          return res
            .status(400)
            .send({ error: `Unsupported network: ${network}` });
        const gasRefundApi = GasRefundApi.getInstance(network);
        const gasRefundDataAddress =
          await gasRefundApi.getAllGasRefundDataForAddress(address);

        return res.json(gasRefundDataAddress);
      } catch (e) {
        logger.error(req.path, e);
        res.status(403).send({
          error: `GasRefundError: could not retrieve merkle data for ${address}`,
        });
      }
    });

    router.get(
      '/gas-refund/stake-migration/:network/:address',
      async (req, res) => {
        const address = req.params.address.toLowerCase();

        try {
          const network = Number(req.params.network);
          if (!GRP_V2_SUPPORTED_CHAINS_STAKING.has(network))
            return res
              .status(403)
              .send({ error: `Unsupported network: ${network}` });
          const gasRefundApi = GasRefundApi.getInstance(network);
          const migration = await gasRefundApi.getMigrationData(
            address,
            network,
          );

          return res.json(migration);
        } catch (e) {
          logger.error(req.path, e);
          res.status(403).send({
            error: `GasRefundError: could not migration data for ${address}`,
          });
        }
      },
    );

    return router;
  }
}
