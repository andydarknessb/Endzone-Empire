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

function signToken(user) {
  return jwt.sign({ sub: user.id, username: user.username }, getSecret(), {
    expiresIn: TOKEN_TTL,
  });
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
    req.user = { id: payload.sub, username: payload.username };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
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
  requireSocketAuth,
  isPlatformAdmin,
  requirePlatformAdmin,
};
