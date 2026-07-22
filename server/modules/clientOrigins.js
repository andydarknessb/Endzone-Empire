function getClientOrigins(env = process.env) {
  const configured = env.CLIENT_ORIGINS || env.APP_ORIGIN || '';
  return [...new Set(configured.split(',').map((origin) => origin.trim()).filter(Boolean))];
}

function getCorsOptions(env = process.env) {
  const origins = getClientOrigins(env);
  return origins.length ? { origin: origins } : { origin: false };
}

module.exports = { getClientOrigins, getCorsOptions };
