const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { createSocketHarness } = require('./helpers/socketHarness');

/**
 * `auth:refresh` (#2555): the handshake records the access token's expiry on the
 * socket, and a client that renewed its token sends the new one so the recorded
 * expiry follows. Nothing disconnects on expiry in this release - the service
 * worker keeps old clients running that never send `auth:refresh`.
 */

const SECRET = 'socket-auth-refresh-secret';
const harness = createSocketHarness({ secret: SECRET });

const USER = { userId: 7, username: 'commish' };

function mint({ id = USER.userId, expiresIn = '1h' } = {}) {
  return jwt.sign({ sub: id, username: `user-${id}` }, SECRET, { expiresIn });
}

const expiryOf = (token) => jwt.decode(token).exp * 1000;

test('the handshake records the token expiry on the socket', async (t) => {
  const handshakeToken = mint({ expiresIn: '10m' });
  const client = await harness.connectAs(USER, t, { auth: { token: handshakeToken } });

  assert.equal(harness.serverSocket(client).data.tokenExpiresAt, expiryOf(handshakeToken));
});

test('a valid token for the same user replaces the recorded expiry', async (t) => {
  const client = await harness.connectAs(USER, t, { auth: { token: mint({ expiresIn: '10m' }) } });
  const renewed = mint({ expiresIn: '1h' });

  const ack = await harness.emit(client, 'auth:refresh', { token: renewed });

  assert.deepEqual(ack, { ok: true });
  assert.equal(harness.serverSocket(client).data.tokenExpiresAt, expiryOf(renewed));
});

test('a token for another user, or an invalid one, is refused and changes nothing', async (t) => {
  const handshakeToken = mint({ expiresIn: '10m' });
  const client = await harness.connectAs(USER, t, { auth: { token: handshakeToken } });
  const recorded = expiryOf(handshakeToken);

  const refused = [
    { token: mint({ id: 8, expiresIn: '1h' }) },
    { token: 'not-a-jwt' },
    { token: jwt.sign({ sub: USER.userId }, 'some-other-secret', { expiresIn: '1h' }) },
    { token: mint({ expiresIn: -60 }) },
    {},
    null,
  ];
  for (const message of refused) {
    const ack = await harness.emit(client, 'auth:refresh', message);
    assert.equal(ack.ok, false, `refused: ${JSON.stringify(message)}`);
    assert.equal(harness.serverSocket(client).data.tokenExpiresAt, recorded, 'the recorded expiry did not move');
  }
  assert.equal(client.connected, true, 'a refusal does not disconnect');
});

test('a socket whose token has expired is not disconnected', async (t) => {
  const client = await harness.connectAs(USER, t, { auth: { token: mint({ expiresIn: 1 }) } });

  await new Promise((resolve) => setTimeout(resolve, 1_500));

  assert.ok(harness.serverSocket(client).data.tokenExpiresAt < Date.now(), 'the token is past its expiry');
  assert.equal(client.connected, true);
});
