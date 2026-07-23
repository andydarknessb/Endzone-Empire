const jwt = require('jsonwebtoken');

// Short-lived by design: clients transparently renew via /api/auth/refresh
// using their rotating refresh token (see token.service).
const TOKEN_TTL = '15m';

function getSecret() {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is not set. Copy .env.example to .env and set it.');
  }
  return process.env.JWT_SECRET;
}

function signToken(user, { authenticatedAt } = {}) {
  const parsedAuthTime = authenticatedAt
    ? Math.floor(new Date(authenticatedAt).getTime() / 1000)
    : Math.floor(Date.now() / 1000);
  if (!Number.isFinite(parsedAuthTime)) {
    throw new Error('authenticatedAt must be a valid date');
  }
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      auth_time: parsedAuthTime,
    },
    getSecret(),
    {
    expiresIn: TOKEN_TTL,
    }
  );
}

/** Express middleware: requires a valid `Authorization: Bearer <jwt>` header. */
function requireAuth(req, res, next) {
  const header = req.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Missing bearer token' });
  }
  try {
    const payload = jwt.verify(token, getSecret());
    req.user = {
      id: payload.sub,
      username: payload.username,
      authenticatedAt: payload.auth_time,
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireRecentAuth(maxAgeSeconds = 10 * 60) {
  return (req, res, next) => {
    const authenticatedAt = Number(req.user?.authenticatedAt);
    if (
      !authenticatedAt ||
      Math.floor(Date.now() / 1000) - authenticatedAt > maxAgeSeconds
    ) {
      return res.status(401).json({
        code: 'RECENT_AUTH_REQUIRED',
        message: 'Sign in again before performing this action',
        requestId: req.id,
      });
    }
    next();
  };
}

/**
 * Is this user a platform administrator? Admins are designated by the
 * PLATFORM_ADMIN_IDS env var (comma-separated user ids) — no admin flag in
 * the database means no way to grant it through any API surface.
 */
function isPlatformAdmin(userId) {
  const raw = process.env.PLATFORM_ADMIN_IDS || '';
  return raw
    .split(',')
    .map((s) => Number(s.trim()))
    .filter(Number.isInteger)
    .includes(Number(userId));
}

/** Express middleware: requireAuth first, then platform-admin designation. */
function requirePlatformAdmin(req, res, next) {
  if (!req.user || !isPlatformAdmin(req.user.id)) {
    return res.status(403).json({ error: 'platform admin access required' });
  }
  next();
}

/** Socket.io middleware: token comes in the connection handshake auth object. */
function requireSocketAuth(socket, next) {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (!token) return next(new Error('unauthorized'));
  try {
    const payload = jwt.verify(token, getSecret());
    socket.user = { id: payload.sub, username: payload.username };
    next();
  } catch (err) {
    next(new Error('unauthorized'));
  }
}

module.exports = {
  signToken,
  requireAuth,
  requireRecentAuth,
  requireSocketAuth,
  isPlatformAdmin,
  requirePlatformAdmin,
};
