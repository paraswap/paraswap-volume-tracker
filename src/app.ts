import {
  VOLUME_TRACKER_INIT_TIME,
  VOLUME_TRACKER_SUPPORTED_NETWORKS,
} from './lib/constants';
import { shutdown as shutdownLog4js } from './lib/log4js';
import Database from './database';
import VolumeTracker from './lib/volume-tracker';
import WebServer from './web-server';
import { PoolInfo } from './lib/pool-info';

const logger = global.LOGGER();

let server: WebServer;

export async function startApp() {
  try {
    logger.info(`Starting app (pid=${process.pid})...`);

    await Promise.all([Database.connectAndSync()]);

    server = new WebServer();
    await server.start(checkDependenciesHealth, stopDependencies);

    // await Promise.all(
    //   VOLUME_TRACKER_SUPPORTED_NETWORKS.map(network => {
    //     if (!VOLUME_TRACKER_INIT_TIME[network]) {
    //       throw new Error(
    //         'VolumeTracker INIT_TIME env var is missing for network ' + network,
    //       );
    //     }
    //     return VolumeTracker.createInstance(
    //       VOLUME_TRACKER_INIT_TIME[network],
    //       network,
    //     ).startIndexing();
    //   }),
    // );
    // await PoolInfo.initStartListening();

    logger.info(`Started app (pid=${process.pid})`);
  } catch (e) {
    logger.error(`Starting app (pid=${process.pid})`, e);
  }
}

async function checkDependenciesHealth() {
  // Database connection validation
  await Database.checkConnected();
}

async function stopDependencies() {
  // we do not need to close Database as Sequelize
  // listens to process exit event and closes all connections automatically
  await Promise.all([]);
}

export async function stopApp(exit: boolean = true) {
  logger.info(`Stopping app (pid=${process.pid})...`);
  try {
    await server.stop();
  } catch (e) {
    logger.warn('Failed shutting down server', e);
  } finally {
    try {
      await stopDependencies();
    } catch (e) {
      logger.warn('Failed stopping dependencies', e);
    }
  }
  logger.info(`Stopped app (pid=${process.pid})`);
  const waitForLogsSeconds = 30;
  if (exit)
    logger.info(`Process will be exiting in ${waitForLogsSeconds} seconds...`);
  await shutdownLog4js();
  if (exit) {
    setTimeout(() => {
      // exiting in waitForLogsSeconds, so last logs will be shipped to CloudWatch
      process.exit();
    }, waitForLogsSeconds * 1000);
  }
}

export function handleErrors() {
  // Print unhandled exception before forced exit
  process.on('uncaughtException', async (err: Error) => {
    logger.error(`uncaughtException (pid=${process.pid})`, err);
    process.exitCode = 1;
    try {
      await stopApp();
    } catch (e) {
      logger.warn('Failed stopping app during uncaughtException', e);
      // nothing to do
    }
  });

  // Print unhandled rejection and avoid abrupt exit
  process.on('unhandledRejection', (reason: string, promise: Promise<any>) => {
    logger.warn(`unhandledRejection (pid=${process.pid})`, reason, promise);
  });
}
