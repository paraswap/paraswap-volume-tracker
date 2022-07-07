/* eslint-disable */
if (process.env.NEW_RELIC_LICENSE_KEY) {
  require('newrelic');
}
require('dotenv').config();

import { init } from './config';

const main = async () => {
  await init();

  const { handleErrors, startApp } = require('./app');

  handleErrors();
  startApp();
};

main();
