/**
 * Root knexfile: `npm run migrate`, `npm run migrate:rollback`, CI's
 * migration-smoke job, and a bare `npx knex ...` from the repo root.
 *
 * THIS IS THE ACCIDENT PATH, and it is the file the 2026-08-23 incident went
 * through. server/knexfile.js is the deploy path. Both require the same
 * resolver; why they are guarded for opposite reasons is written down once,
 * in server/modules/knexTarget.js (#258), along with what is printed and
 * refused. Read that rather than the two headers here.
 */
require('dotenv').config();
const { resolveKnexConnection } = require('./server/modules/knexTarget');

module.exports = {
  client: 'pg',
  // Announces the resolved target on stderr, then throws before any
  // connection is opened if it is not loopback and KNEX_ALLOW_REMOTE is unset.
  connection: resolveKnexConnection(),
  migrations: {
    directory: './server/db/migrations',
  },
  seeds: {
    directory: './server/db/seeds',
  },
};
