/**
 * Server knexfile: what `npm --prefix server run migrate` uses, which is
 * exactly what render.yaml's `preDeployCommand` runs on every API deploy.
 *
 * THIS IS THE DEPLOY PATH, and it is guarded for the opposite reason to the
 * root knexfile. Reaching a remote host here is not the accident, it is the
 * job: production migrations are supposed to run against
 * DATABASE_URL_MIGRATIONS. So the opt-in is declared beside those credentials
 * in render.yaml (`KNEX_ALLOW_REMOTE: "1"`, web service only) and the deploy
 * passes the guard by saying out loud what it is doing, while still printing
 * which variable supplied the target.
 *
 * The root knexfile is the ACCIDENT path. Guarding only one of the two would
 * leave the incident reproducible through the other, and worse: a change that
 * guarded only the root file could watch the deploy carry on working and call
 * that proof, when the deploy never touches the root file at all. That is
 * this ticket's own defect, a check that silently examined the wrong thing,
 * one level up.
 *
 * See server/modules/knexTarget.js (#258) for what is printed and refused.
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
