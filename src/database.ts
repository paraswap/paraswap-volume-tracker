import { Client } from 'pg';
import { Sequelize } from 'sequelize-typescript';
import * as cls from 'cls-hooked';

const logger = global.LOGGER();

const IS_DEV = process.env.NODE_ENV === 'development';

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgres://paraswap:paraswap@127.0.0.1:32780/volume_tracker';

const DATABASE_NAME = process.env.DATABASE_NAME || 'volume_tracker';

export class Database {
  sequelize: Sequelize;

  async connectAndSync(namespace?: string) {
    if (namespace) {
      const _namespace = cls.createNamespace(namespace);
      Sequelize.useCLS(_namespace);
    }

    // create a volume-tracker DB if it doesn't exist already
    const connectionStringParts = DATABASE_URL.split('/');
    const connectionStringDBName =
      connectionStringParts[connectionStringParts.length - 1];
    if (connectionStringDBName !== DATABASE_NAME) {
      logger.info(
        'Database name in connection string is different than expected',
      );
      const client = new Client({ connectionString: DATABASE_URL });
      await client.connect();
      try {
        await client.query(`CREATE DATABASE ${DATABASE_NAME};`);
        logger.info('Created expected database');
      } catch (e) {
        if (e.code && e.code === '42P04') {
          logger.info('Expected database already exists');
        } else {
          logger.error('Failed creating expected database', e);
        }
      }
      connectionStringParts.splice(
        connectionStringParts.length - 1,
        1,
        DATABASE_NAME,
      );
      logger.info('Updated database name in connection string');
    }

    const connectionString = connectionStringParts.join('/');
    this.sequelize = new Sequelize(connectionString, {
      logging: IS_DEV ? msg => logger.debug(msg) : undefined,
      models: [__dirname + '/models'],
      // needed locally to connect to docker db
      ...(IS_DEV && {
        dialectOptions: {
          ssl: false,
        },
      }),
    });

    try {
      logger.info('Connecting to database...');
      await this.sequelize.authenticate();
      logger.info('Connected to database');
    } catch (e) {
      logger.error('Connecting to database', e);
      throw e;
    }

    try {
      logger.info('Syncing database...');
      await this.sequelize.sync();
      logger.info('Synced database');
    } catch (e) {
      logger.error('Syncing database', e);
      throw e;
    }
  }

  async checkConnected() {
    let connection;
    try {
      // get connection to check
      try {
        connection = await this.sequelize.connectionManager.getConnection({
          type: 'write',
        });
      } catch (e) {
        throw new Error('Database connection not available!');
      }

      // validate connection
      if (!(this.sequelize.connectionManager as any).validate(connection)) {
        throw new Error('Database connection down!');
      }
    } finally {
      // release connection if one acquired
      if (connection) {
        try {
          await this.sequelize.connectionManager.releaseConnection(connection);
        } catch (e) {
          logger.warn('checkConnected connection release', e);
        }
      }
    }
  }
}

export default new Database();
