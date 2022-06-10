import * as express from 'express';
import * as parser from 'body-parser';
import * as compression from 'compression';
import * as cookie from 'cookie-parser';
import AsyncContextMiddleware from './async-context';
import RemoteAddressMiddleware from './remote-address';

const logger = global.LOGGER();

export default class Middleware {
  path: string;

  constructor(path: string) {
    this.path = path;
  }

  static getHostname(req: express.Request) {
    return req.headers['x-forwarded-server']
      ? req.headers['x-forwarded-server']
      : req.headers.host
      ? req.headers.host
      : 'localhost';
  }

  /**
   * Configure Express app middleware.
   * Middleware will be added at the beginning of the stack.
   */
  before(app: express.Express) {
    app.use(function (req, res, next) {
      res.header('Access-Control-Allow-Origin', '*');
      res.header(
        'Access-Control-Allow-Headers',
        'Origin, X-Requested-With, Content-Type, Accept, X-Partner',
      );
      next();
    });

    /**
     * Use JSON Body parser...
     */
    app.use(parser.json({ strict: false }));
    app.use(parser.text());

    /**
     * Compress requests...
     */
    app.use(compression());
    app.use(cookie());

    // creates async context
    app.use(AsyncContextMiddleware());

    // extracts and injects remote address to async context
    app.use(RemoteAddressMiddleware());

    app.get('/robots.txt', function (req, res) {
      res.type('text/plain');
      res.send(`
        # You look like a cool developer :-) We're looking to grow our dream team, learn more here https://paraswap.io/jobs
        User-agent: *
      `);
    });

    app.get('/humans.txt', function (req, res) {
      res.type('text/plain');
      res.send(`
        # You look like a cool developer :-) We're looking to grow our dream team, learn more here https://paraswap.io/jobs
        User-agent: *
      `);
    });

    app.use(
      (
        req: express.Request,
        res: express.Response,
        next: express.NextFunction,
      ) => {
        res.set('X-Recruitment', 'Find jobs at https://paraswap.io/jobs ;)');
        next();
      },
    );
  }

  /**
   * Configure Express app middleware.
   * Middleware will be added at the end of the stack.
   */
  after(app: express.Express) {
    /**
     * Server error handler.
     */
    app.use(
      (
        err: any,
        req: express.Request,
        res: express.Response,
        next: express.NextFunction,
      ) => {
        // eslint-disable-line no-unused-vars
        if (err.status === 401) {
          return res.status(401).send(err.message);
        }

        if (err.message) {
          return res.status(403).send(err.message);
        }

        logger.error(err.stack || err.toString(), {
          hostname: Middleware.getHostname(req),
        });
        res
          .status(500)
          .send(
            'Oops! An error has occurred. Please contact the service Admin.',
          );
      },
    );
  }
}
