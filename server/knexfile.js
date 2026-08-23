/**
 * Server knexfile: `npm --prefix server run migrate`, which is exactly what
 * render.yaml's `preDeployCommand` runs on every API deploy.
 *
 * THIS IS THE DEPLOY PATH. Reaching a remote host here is not the accident,
 * it is the job, so render.yaml declares `KNEX_ALLOW_REMOTE: "1"` on the API
 * web service and this file passes the guard by saying out loud what it is
 * doing. Change that variable there and deploys stop migrating.
 *
 * The root knexfile is the accident path; why both are guarded, and why
 * guarding only one would produce a green that certifies nothing, is written
 * down once in server/modules/knexTarget.js (#258).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const { resolveKnexConnection } = require('./modules/knexTarget');

module.exports = {
  client: 'pg',
  // Announces the resolved target on stderr, then throws before any
  // connection is opened if it is not loopback and KNEX_ALLOW_REMOTE is unset.
  connection: resolveKnexConnection(),
  migrations: { directory: path.join(__dirname, 'db', 'migrations') },
  seeds: { directory: path.join(__dirname, 'db', 'seeds') },
};
