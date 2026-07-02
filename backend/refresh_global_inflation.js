#!/usr/bin/env node
// One-off/manual run: node refresh_global_inflation.js
// (The daily scheduled version lives in server.js via node-cron.)

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { refreshGlobalInflation } = require('./services/inflationRefreshService');

refreshGlobalInflation()
  .then((result) => {
    console.log('Done:', result);
    process.exit(0);
  })
  .catch((err) => {
    console.error('Inflation refresh failed:', err.message);
    process.exit(1);
  });
