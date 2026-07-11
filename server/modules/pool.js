const pg = require('pg');
const { sslForConnection } = require('./dbSsl');

// Connection settings come from the environment only — see .env.example.
// DATABASE_URL wins (production); otherwise the standard PG* variables are
// read by the pg driver itself, with sensible local defaults.
const pool = process.env.DATABASE_URL
  ? new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: sslForConnection(process.env.DATABASE_URL),
    })
  : new pg.Pool({
      host: process.env.PGHOST || 'localhost',
      port: Number(process.env.PGPORT) || 5432,
      database: process.env.PGDATABASE || 'endzone_empire',
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
    });

module.exports = pool;
