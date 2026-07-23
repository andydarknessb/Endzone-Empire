const fs = require('fs');

function certificateAuthority() {
  if (process.env.DB_SSL_CA) return process.env.DB_SSL_CA.replace(/\\n/g, '\n');
  if (process.env.DB_SSL_CA_PATH) return fs.readFileSync(process.env.DB_SSL_CA_PATH, 'utf8');
  return null;
}

function sslForConnection(connectionString) {
  const mode = process.env.PGSSLMODE;
  const production = process.env.NODE_ENV === 'production';
  try {
    const host = new URL(connectionString).hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]' || host === '') {
      return false;
    }
  } catch (err) {
    // Unparseable URL — let pg surface the real error; assume remote/SSL
  }
  if (mode === 'disable') {
    if (production) throw new Error('PGSSLMODE=disable is forbidden for a production database');
    return false;
  }
  const ca = certificateAuthority();
  if (production && !ca) {
    throw new Error('DB_SSL_CA or DB_SSL_CA_PATH is required for production database verification');
  }
  return ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: false };
}

module.exports = { certificateAuthority, sslForConnection };
