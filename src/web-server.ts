import * as express from 'express';
import * as http from 'http';
import { StoppableServer } from 'stoppable';
import { createTerminus } from '@godaddy/terminus';

import Router from './router';
import Middleware from './lib/middleware';

const logger = global.LOGGER();

const PORT = process.env.PORT || 3232;

export default class WebServer {
  httpServer: StoppableServer;

  async start(
    healthCheckFunc: () => Promise<any>,
    stopFunc: () => Promise<any>,
  ) {
    logger.info(`Staring server...`);

    const app = express();

    app.set('case sensitive routing', true);
    app.set('strict routing', true);
    app.set('x-powered-by', false);

    const router = new Router();
    const middleware = new Middleware('');

    middleware.before(app);
    router.configure(app);
    middleware.after(app);

    const httpServer = new http.Server(app);

    /* read: https://adamcrowder.net/posts/node-express-api-and-aws-alb-502/ */
    // Ensure all inactive connections are terminated by the ALB, by setting this a few seconds higher than the ALB idle timeout (60 secs)
    httpServer.keepAliveTimeout = 70 * 1000;
    // Ensure the headersTimeout is set higher than the keepAliveTimeout due to this nodejs regression bug: https://github.com/nodejs/node/issues/27363
    httpServer.headersTimeout = 80 * 1000;

    const terminusOptions = {
      signals: ['SIGTERM', 'SIGINT'],
      timeout: 30 * 1000,
      beforeShutdown: async () => {
        logger.info('Stopping server...');
      },
      onSignal: async () => {
        logger.info('Stopped server');
        await stopFunc();
      },
      healthChecks: {
        '/healthz': healthCheckFunc,
        __unsafeExposeStackTraces: process.env.NODE_ENV !== 'production',
      },
      logger: logger.error,
    };

    this.httpServer = createTerminus(
      httpServer,
      terminusOptions,
    ) as StoppableServer;

    this.httpServer.listen(PORT, () => {
      logger.info(`Started server on port ${PORT}`);
    });
  }

  stop() {
    return new Promise<void>((resolve, reject) => {
      logger.info('Stopping server...');
      this.httpServer.stop((e: Error) => {
        if (e) {
          logger.warn('Stopping server', e);
          reject(e);
        } else {
          logger.info('Stopped server');
          resolve();
        }
      });
    });
  }
}
