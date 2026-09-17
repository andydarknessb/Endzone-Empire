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

// An idle pooled client can take a socket error at any time (the pooler
// closing a connection, a TLS read failing). pg-pool re-emits those on the
// pool; with no listener here the error would be thrown as an uncaught
// exception and take the whole process down. On 2026-09-16 exactly that
// (`read ECONNABORTED` on a client the pool was closing) ended the worker
// (#1535). The client is already discarded by the pool; nothing to do but
// say so. The worker's fatal handler is the second line of defence for the
// errors pg raises outside this path.
pool.on('error', (error) => {
  console.error('postgres pool: idle client error, connection discarded:', error && error.message);
});

module.exports = pool;
