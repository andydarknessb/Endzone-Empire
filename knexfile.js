require('dotenv').config();
const { sslForConnection } = require('./server/modules/dbSsl');

const connection = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: sslForConnection(process.env.DATABASE_URL),
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
