/**
 * Decide the pg `ssl` option for a DATABASE_URL connection.
 *
 * Explicit PGSSLMODE always wins ('disable' -> off, anything else -> on).
 * Without it, default by host: local Postgres installs ship with ssl=off,
 * so localhost connections get no SSL; remote hosts (Heroku, RDS, etc.)
 * get SSL with rejectUnauthorized disabled, which those platforms require.
 */
function sslForConnection(connectionString) {
  const mode = process.env.PGSSLMODE;
  if (mode) {
    return mode === 'disable' ? false : { rejectUnauthorized: false };
  }
  try {
    const host = new URL(connectionString).hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]' || host === '') {
      return false;
    }
  } catch (err) {
    // Unparseable URL — let pg surface the real error; assume remote/SSL
  }
  return { rejectUnauthorized: false };
}

module.exports = { sslForConnection };
