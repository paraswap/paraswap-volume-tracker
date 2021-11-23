require('dotenv').config();

if (process.env.NEW_RELIC_LICENSE_KEY) {
  require('newrelic');
}

import { handleErrors, startApp } from './app';

handleErrors();

startApp();
