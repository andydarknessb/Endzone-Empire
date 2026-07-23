const { validateEnvironment } = require('../server/modules/config');

validateEnvironment({ ...process.env, NODE_ENV: 'production' });
console.log('Production environment variables passed schema validation.');
