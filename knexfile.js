require('dotenv').config();
const { sslForConnection } = require('./server/modules/dbSsl');

const migrationDatabaseUrl =
  process.env.DATABASE_URL_MIGRATIONS ||
  process.env.DATABASE_URL_RUNTIME ||
  process.env.DATABASE_URL;
const connection = migrationDatabaseUrl
  ? {
      connectionString: migrationDatabaseUrl,
      ssl: sslForConnection(migrationDatabaseUrl),
    }
  : {
      host: process.env.PGHOST || 'localhost',
      port: Number(process.env.PGPORT) || 5432,
      database: process.env.PGDATABASE || 'endzone_empire',
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
    };

module.exports = {
  client: 'pg',
  connection,
  migrations: {
    directory: './server/db/migrations',
  },
  seeds: {
    directory: './server/db/seeds',
  },
};
