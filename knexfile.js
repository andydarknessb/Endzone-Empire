/**
 * Root knexfile: what `npm run migrate` / `npm run migrate:rollback` use, and
 * what a bare `npx knex ...` from the repo root picks up.
 *
 * THIS IS THE ACCIDENT PATH. The 2026-08-23 incident went through this file:
 * an agent ran `npx knex migrate:latest` from a worktree root with PG* set at
 * a local container, and a `.env`-supplied DATABASE_URL silently won. CI's
 * migration-smoke job also runs through here, against a loopback PG* service
 * container, which is what keeps that job green without an opt-in.
 *
 * server/knexfile.js is the DEPLOY path (Render's preDeployCommand), guarded
 * for the opposite reason: it must keep reaching a remote host. Both require
 * the same resolver, so neither can be fixed while the other stays open.
 *
 * See server/modules/knexTarget.js (#258) for what is printed and refused.
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
