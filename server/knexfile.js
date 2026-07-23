require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const { sslForConnection } = require('./modules/dbSsl');

const connectionString =
  process.env.DATABASE_URL_MIGRATIONS ||
  process.env.DATABASE_URL_RUNTIME ||
  process.env.DATABASE_URL;

const connection = connectionString
  ? { connectionString, ssl: sslForConnection(connectionString) }
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
  migrations: { directory: path.join(__dirname, 'db', 'migrations') },
  seeds: { directory: path.join(__dirname, 'db', 'seeds') },
};
