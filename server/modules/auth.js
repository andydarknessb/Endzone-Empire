const jwt = require('jsonwebtoken');

const TOKEN_TTL = '7d';

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

module.exports = { signToken, requireAuth, requireSocketAuth };
