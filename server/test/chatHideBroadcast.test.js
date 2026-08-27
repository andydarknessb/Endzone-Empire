const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createSocketHarness } = require('./helpers/socketHarness');
const { createFakePool, update } = require('./helpers/fakePool');
const { signToken } = require('../modules/auth');
const { LEAGUE_CHAT } = require('../services/leagueFeed');
const safetyRouter = require('../routes/safety.router');

/**
 * #441 AC7 (multi-client) and AC3/AC5, proven end to end: a commissioner hides a
 * chat message over REST (POST /api/safety/hide), and every member CONNECTED to
 * the league room receives the neutral tombstone LIVE, through the real
 * socket.io server the safety route reaches via getIo(). The block filter is
 * inherited from #440's deliverFeedEntry: a viewer who blocked the author, who
 * never saw the message, never sees its tombstone either.
 *
 * The harness owns JWT_SECRET (set at module top), so the same signToken mints
 * both the REST bearer and the socket handshakes against one secret.
 */
const harness = createSocketHarness({ secret: 'chat-hide-broadcast-secret' });

const app = express();
app.use(express.json());
app.use('/api/safety', safetyRouter);

const A = { userId: 7, username: 'author' };
const B = { userId: 8, username: 'blocker' };
const C = { userId: 9, username: 'neutral' };
const M = { userId: 5, username: 'commish' };

/** A small world answering the socket-join reads and the REST hide reads off
 *  one shared fake pool: who holds a Team, who is a commissioner, who blocked
 *  whom, and a hide UPDATE that returns the freshly-hidden row. */
function hideWorld({ leagueId, teams, commissioners = [], blocks = [], authorId = A.userId }) {
  const state = {
    teams: new Map(Object.entries(teams).map(([uid, tm]) => [Number(uid), tm])),
    blocks: [...blocks],
  };
  const commish = new Set(commissioners);
  const fake = createFakePool([
    // lookupTeam — the socket join membership read AND the hide's authorTeam read.
    [/^SELECT "id", "name" FROM "teams"/, (t, [lg, uid]) => {
      const team = lg === leagueId ? state.teams.get(uid) : undefined;
      return { rows: team ? [{ id: team.teamId, name: team.teamName }] : [] };
    }],
    // isLeagueCommissioner — socket join AND the REST hide authorization.
    [/^SELECT 1 FROM "leagues"/, (t, [lg, uid]) => ({
      rows: lg === leagueId && commish.has(uid) ? [{ '?column?': 1 }] : [],
    })],
    // The hide UPDATE returns the now-hidden row, authored by `authorId`.
    [update('chat_messages'), (t, [, , msgId]) => ({
      rows: [{
        id: msgId,
        feed_seq: 99,
        created_at: '2026-09-01T00:00:00.000Z',
        user_id: authorId,
        hidden_at: '2026-09-01T01:00:00.000Z',
      }],
    })],
    // listBlockersOf — who has blocked the author, for block-aware delivery.
    [/^SELECT "blocker_id" FROM "user_blocks"/, (t, [blockedId]) => ({
      rows: state.blocks.filter((b) => b.blocked === blockedId).map((b) => ({ blocker_id: b.blocker })),
    })],
  ]);
  return { fake, state };
}

/** Resolve with the event payload, or null after `ms` (assert an absence). */
function eventOrSilence(client, event, ms = 400) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    client.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

test('a commissioner hide broadcasts a neutral tombstone to the room, skipping a blocker', async (t) => {
  const leagueId = 4501;
  const world = hideWorld({
    leagueId,
    teams: {
      [A.userId]: { teamId: 71, teamName: 'Founders' },
      [B.userId]: { teamId: 81, teamName: 'Blocker' },
      [C.userId]: { teamId: 91, teamName: 'Neutral' },
    },
    commissioners: [M.userId],
    blocks: [{ blocker: B.userId, blocked: A.userId }],
  });
  world.fake.install(t);

  const author = await harness.connectAs(A, t);
  const blocker = await harness.connectAs(B, t);
  const neutral = await harness.connectAs(C, t);
  await harness.emit(author, 'league:join', { leagueId });
  await harness.emit(blocker, 'league:join', { leagueId });
  await harness.emit(neutral, 'league:join', { leagueId });

  let blockerGot = false;
  blocker.on('chat:hidden', () => { blockerGot = true; });
  const neutralGot = eventOrSilence(neutral, 'chat:hidden');
  const authorGot = eventOrSilence(author, 'chat:hidden');

  const res = await request(app)
    .post('/api/safety/hide')
    .set('Authorization', `Bearer ${signToken({ id: M.userId, username: M.username })}`)
    .send({ leagueId, messageId: 55, reason: 'targeted harassment' });
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const tombstone = await neutralGot;
  assert.ok(tombstone, 'a member in the room receives the tombstone live');
  assert.equal(tombstone.type, LEAGUE_CHAT);
  assert.equal(tombstone.hidden, true);
  assert.equal(tombstone.message, null, 'the tombstone carries no content');
  assert.equal(tombstone.leagueId, leagueId);
  // The reason and the moderator never ride on the wire (AC3 neutral, AC4 keeps
  // them to the reviewer history alone).
  assert.equal('reason' in tombstone, false);
  assert.equal('hidden_reason' in tombstone, false);
  assert.equal('hidden_by' in tombstone, false);

  assert.ok(await authorGot, 'the author sees their own message become a tombstone');
  assert.equal(blockerGot, false, 'a viewer who blocked the author never receives the tombstone');
});
