import * as express from 'express';
import { isAddress } from '@ethersproject/address';
import VolumeTracker from './lib/volume-tracker';
import { MarketMakerAddresses } from './lib/volume-tracker';
import { PoolInfo } from './lib/pool-info';
import { Claim } from './models/Claim';
import { DEFAULT_CHAIN_ID, STAKING_CHAIN_IDS_SET, CHAIN_ID_MAINNET } from './lib/constants';
import { GasRefundApi } from './lib/gas-refund-api';
import { EpochInfo } from './lib/epoch-info';
import { GRP_SUPPORTED_CHAINS } from './lib/gas-refund';

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
        if (!STAKING_CHAIN_IDS_SET.has(network)) {
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
        if (!STAKING_CHAIN_IDS_SET.has(network)) {
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

    router.get(
      '/gas-refund/user-data/:network/:address',
      async (req, res) => {
        const address = req.params.address.toLowerCase();

        try {
          const network = Number(req.params.network);
          if (!GRP_SUPPORTED_CHAINS.includes(network))
            return res
              .status(403)
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
      },
    );

    // @TODO: remove
    router.get('/gas-refund/describe', async (req, res) => {
      const epoch = Number(req.query.epoch);
      const network = Number(req.query.network);

      if (isNaN(epoch) || isNaN(network))
        return res
          .status(403)
          .send({ error: 'please pass ?epoch=:epoch&network=:network' });

      try {
        const gasRefundApi = GasRefundApi.getInstance(network);

        const [root, leaves] = await Promise.all([
          gasRefundApi.gasRefundDataForEpoch(epoch),
          gasRefundApi.getAllEntriesForEpoch(epoch),
        ]);
        return res.json({
          root,
          leaves,
        });
      } catch (e) {
        logger.error(req.path, e);
        res.status(403).send({
          error: `GasRefundError: could not retrieve grp data for chain=${network} epoch=${epoch}`,
        });
      }
    });

    return router;
  }
}
