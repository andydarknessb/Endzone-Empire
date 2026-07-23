const { getClientOrigins } = require('./clientOrigins');

const COOKIE_NAME = 'endzone_refresh';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function parseCookieHeader(header = '') {
  return String(header)
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const separator = part.indexOf('=');
      if (separator < 0) return cookies;
      const key = decodeURIComponent(part.slice(0, separator));
      const value = decodeURIComponent(part.slice(separator + 1));
      cookies[key] = value;
      return cookies;
    }, {});
}

function getRefreshToken(req) {
  return parseCookieHeader(req.get('cookie'))[COOKIE_NAME] || null;
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/auth',
    maxAge: MAX_AGE_MS,
  };
}

function setRefreshCookie(res, token) {
  res.cookie(COOKIE_NAME, token, cookieOptions());
}

function clearRefreshCookie(res) {
  const { maxAge, ...options } = cookieOptions();
  res.clearCookie(COOKIE_NAME, options);
}

function requireTrustedOrigin(req, res, next) {
  if (process.env.NODE_ENV !== 'production') return next();
  const origin = req.get('origin');
  if (!origin || !getClientOrigins().includes(origin)) {
    return res.status(403).json({
      code: 'UNTRUSTED_ORIGIN',
      message: 'Request origin is not allowed',
      requestId: req.id,
    });
  }
  next();
}

module.exports = {
  COOKIE_NAME,
  MAX_AGE_MS,
  clearRefreshCookie,
  getRefreshToken,
  parseCookieHeader,
  requireTrustedOrigin,
  setRefreshCookie,
};
