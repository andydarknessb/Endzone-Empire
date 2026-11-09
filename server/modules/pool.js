const pg = require('pg');
const { sslForConnection } = require('./dbSsl');

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const poolOptions = {
  max: positiveInteger(process.env.PGPOOL_MAX, 10),
  idleTimeoutMillis: positiveInteger(process.env.PGPOOL_IDLE_TIMEOUT_MS, 30000),
  connectionTimeoutMillis: positiveInteger(process.env.PGPOOL_CONNECTION_TIMEOUT_MS, 5000),
  statement_timeout: positiveInteger(process.env.PG_STATEMENT_TIMEOUT_MS, 15000),
  application_name: process.env.SERVICE_NAME || 'endzone-empire-api',
};

// Connection settings come from the environment only — see .env.example.
// DATABASE_URL wins (production); otherwise the standard PG* variables are
// read by the pg driver itself, with sensible local defaults.
const runtimeDatabaseUrl = process.env.DATABASE_URL_RUNTIME || process.env.DATABASE_URL;
const pool = runtimeDatabaseUrl
  ? new pg.Pool({
      ...poolOptions,
      connectionString: runtimeDatabaseUrl,
      ssl: sslForConnection(runtimeDatabaseUrl),
    })
  : new pg.Pool({
      ...poolOptions,
      host: process.env.PGHOST || 'localhost',
      port: Number(process.env.PGPORT) || 5432,
      database: process.env.PGDATABASE || 'endzone_empire',
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
    });

// A pooled client can take a socket error at any time (the pooler closing a
// connection, a TLS read failing). pg-pool detaches its idle listener when a
// client is checked out, so a connection that drops mid-query needs this
// listener to exist for the client's whole life or Node throws the 'error' and
// takes the process down (#1535, 2026-09-16). The query in flight still rejects
// as before; this listener only logs what the client heard. The worker's fatal
// handler is the second line of defence for errors pg raises outside this path.
pool.on('connect', (client) => {
  client.on('error', (error) => {
    console.error('postgres client error:', error && error.message);
  });
});

// pg-pool re-emits idle-client errors on the pool after the client listener
// above has logged them; with no pool listener that re-emit throws.
pool.on('error', () => {});

module.exports = pool;
