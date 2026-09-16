const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool } = require('./helpers/fakePool');
const { leagueDetail, LeagueDetailError } = require('../services/leagueDetail.service');

// Two grants, because the roster's two viewer-relative rules differ on them:
// one co-commissioner still holds their Team, and one no longer does. The
// second is why listCoCommissioners joins LEFT - a grant briefly outlives the
// team when a commissioner removes the team before revoking the role - and it
// has no Team identity to show a member.
const GRANTED_AT = '2026-08-12T10:00:00.000Z';
const GRANT_WITH_TEAM = {
  user_id: 42, username: 'alice', created_at: GRANTED_AT, teamId: 11, teamName: "Alice's Team",
};
const GRANT_WITHOUT_TEAM = {
  user_id: 43, username: 'ghost', created_at: GRANTED_AT, teamId: null, teamName: null,
};

/**
 * The shared fake-pool helper (server/test/helpers/fakePool.js), installed
 * over the shared pool module for the duration of the test - `leagueDetail`'s
 * own `db` default (`db = pool`) then routes every query through it, exactly
 * as the fake's docstring describes for `getMarketStatus`'s internal
 * `require('../modules/pool')` call (adp.service.js), which no `db` argument
 * this module passes can redirect.
 *
 * The market status line (#748) defaults to a fresh market - plenty of
 * players, a recent ok sync - so tests that don't care about it aren't forced
 * to think about it. The dedicated market tests below override adpPlayers,
 * lastAdpRun and dataSyncRunsError one at a time.
 */
function mockLeagueDetail(t, {
  isCommissioner = true,
  coCommissioners = [],
  adpPlayers = 250,
  lastAdpRun = { finished_at: new Date().toISOString() },
  dataSyncRunsError = null,
  draftStatus = 'pending',
  rosterLimit = 20,
  irSlots = 1,
  irStashes = [],
  leagueRow = null,
} = {}) {
  const seen = {};
  const fake = createFakePool([
    [/ownerTeamId/, () => ({
      rows: [leagueRow || {
        id: 1, owner_id: 7, name: 'Sunday Ballers', invite_code: 'invite',
        ownerTeamId: 11, ownerTeamName: "Alice's Team", draft_status: draftStatus,
        roster_limit: rosterLimit, ir_slots: irSlots,
      }],
    })],
    [/FROM "lineup_entries"/, (text) => {
      seen.stashQuery = text;
      return { rows: irStashes };
    }],
    [/^SELECT 1 FROM "teams"/, () => ({ rows: [{ '?column?': 1 }] })],
    [/^SELECT 1 FROM "leagues"/, () => ({ rows: isCommissioner ? [{ '?column?': 1 }] : [] })],
    [/FROM "league_commissioners"/, () => ({ rows: coCommissioners })],
    [/FROM "players"/, () => ({ rows: [{ n: adpPlayers }] })],
    [/FROM "data_sync_runs"/, () => {
      if (dataSyncRunsError) throw dataSyncRunsError;
      return { rows: lastAdpRun ? [lastAdpRun] : [] };
    }],
    [/COUNT\("team_players"\."id"\)/, (text) => {
      seen.teamsQuery = text;
      return {
        rows: [{
          // Both `id` and `teamId`, because the module projects both: the raw
          // column and the contract alias teamIdentityColumns() puts beside
          // it. A fixture carrying only `id` would let a comparison against
          // the legacy column pass while the contract one silently matched
          // nothing - which is what the co-commissioner flag reads.
          id: 11,
          teamId: 11,
          name: "Alice's Team",
          owner_id: 42, // on the raw row for viewerTeamId; stripped from serialization (#343)
          draft_position: 1,
          faab_remaining: 100,
          locked: false,
          draft_ready: true,
          roster_count: 0,
        }],
      };
    }],
  ]);
  fake.install(t);
  return seen;
}

test('leagueDetail selects and serializes team readiness', async (t) => {
  const leagueRow = { id: 1, owner_id: 7, name: 'Sunday Ballers', invite_code: 'invite', ownerTeamId: 11, ownerTeamName: "Alice's Team" };
  const seen = mockLeagueDetail(t, { leagueRow, draftStatus: undefined });

  const detail = await leagueDetail({ leagueId: 1, viewer: 7 }, {});

  assert.match(seen.teamsQuery, /"teams"\."draft_ready"/);
  assert.equal(detail.teams[0].draft_ready, true);
});

// #1475: each team's occupancy-based capacity rides beside roster_count so
// the Roster tile never sizes a roster by the IR-inclusive roster_limit.
test("leagueDetail publishes each team's roster_capacity, sized by its eligible IR stash", async (t) => {
  const seen = mockLeagueDetail(t, { rosterLimit: 20, irSlots: 1, irStashes: [] });

  const detail = await leagueDetail({ leagueId: 1, viewer: 42 }, {});

  // 20 minus the IR slot, and nothing stashed: 19, with roster_limit itself untouched.
  assert.equal(detail.teams[0].roster_capacity, 19);
  assert.equal(detail.league.roster_limit, 20);
  assert.match(seen.stashQuery, /GROUP BY "lineup_entries"\."team_id"/);
});

test('leagueDetail grants the IR spot to a team with an eligible stash', async (t) => {
  mockLeagueDetail(t, { rosterLimit: 20, irSlots: 1, irStashes: [{ team_id: 11, n: 1 }] });

  const detail = await leagueDetail({ leagueId: 1, viewer: 42 }, {});

  assert.equal(detail.teams[0].roster_capacity, 20);
});

test('leagueDetail gives a commissioner the invite code and the ids grant and revoke need', async (t) => {
  const seen = mockLeagueDetail(t, {
    isCommissioner: true,
    coCommissioners: [GRANT_WITH_TEAM, GRANT_WITHOUT_TEAM],
  });

  const detail = await leagueDetail({ leagueId: 1, viewer: 99 }, {});

  assert.equal(detail.league.is_commissioner, true);
  assert.equal(detail.league.invite_code, 'invite');
  // The account id rides commissioner-conditionally, decided on the same
  // boolean an adjacent line strips invite_code by: DELETE
  // /co-commissioners/:userId is account-shaped, so a commissioner cannot
  // revoke without it. The username is not part of what grant and revoke need
  // and does not ride at all. grantedAt rides with the id because Team
  // identity does not identify a grant on its own (duplicate Team names are
  // valid), and a commissioner has to know which one they are revoking.
  assert.deepEqual(detail.league.co_commissioners, [
    { user_id: 42, grantedAt: GRANTED_AT, teamId: 11, teamName: "Alice's Team" },
    // A grant whose Team is gone still reaches the commissioner who has to
    // revoke it, even though there is no Team identity left to name it by.
    { user_id: 43, grantedAt: GRANTED_AT, teamId: null, teamName: null },
  ]);
  // owner_id still rides in the SELECT so viewerTeamId can resolve off the raw
  // rows, but it is stripped from the serialized entry (#343): even a
  // commissioner reads teams[] by Team identity, and identifies a promote
  // target by teamId (the server resolves the account behind it).
  assert.match(seen.teamsQuery, /"teams"\."owner_id"/);
  assert.equal('owner_id' in detail.teams[0], false);
});

test('leagueDetail names commissioner power by Team, never by account, for a plain member', async (t) => {
  mockLeagueDetail(t, {
    isCommissioner: false,
    coCommissioners: [GRANT_WITH_TEAM, GRANT_WITHOUT_TEAM],
  });

  const detail = await leagueDetail({ leagueId: 1, viewer: 55 }, {});

  assert.equal(detail.league.is_commissioner, false);
  assert.equal(detail.league.invite_code, undefined);
  // Who holds power is not secret. WHICH TEAM holds it is the whole of the
  // disclosure (#324): a member can see the power without ever being handed
  // another manager's account, and the grant with no Team has no Team identity
  // to show, so it is simply not in the member-visible view.
  assert.deepEqual(detail.league.co_commissioners, [
    { teamId: 11, teamName: "Alice's Team" },
  ]);
  for (const entry of detail.league.co_commissioners) {
    assert.equal('user_id' in entry, false);
    assert.equal('username' in entry, false);
  }
  // And the same fact reaches the member off the Team identity they already
  // hold, so no surface has to join the roster back to a team to render it.
  assert.equal(detail.teams[0].is_co_commissioner, true);
});

test('leagueDetail flags only the teams whose manager holds a grant', async (t) => {
  mockLeagueDetail(t, { isCommissioner: false, coCommissioners: [GRANT_WITHOUT_TEAM] });

  const detail = await leagueDetail({ leagueId: 1, viewer: 55 }, {});

  // The flag is present and false rather than absent, so a consumer can read
  // it unconditionally - and a grant that no longer names a Team flags none.
  assert.equal(detail.teams[0].is_co_commissioner, false);
  assert.deepEqual(detail.league.co_commissioners, []);
});

// ---------------------------------------------------------- market (#748)

test('leagueDetail carries a market object with adpPlayers, floor, lastSyncAt and stale', async (t) => {
  const recent = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // 1 day ago
  mockLeagueDetail(t, { adpPlayers: 250, lastAdpRun: { finished_at: recent } });

  const detail = await leagueDetail({ leagueId: 1, viewer: 7 }, {});

  assert.deepEqual(Object.keys(detail.league.market).sort(), ['adpPlayers', 'floor', 'lastSyncAt', 'stale']);
  assert.equal(detail.league.market.adpPlayers, 250);
  assert.equal(detail.league.market.floor, 100);
  assert.equal(detail.league.market.lastSyncAt, recent);
  assert.equal(detail.league.market.stale, false);
});

test('leagueDetail marks the market stale once the latest ok run is older than MARKET_STALE_DAYS', async (t) => {
  const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(); // 8 days ago
  mockLeagueDetail(t, { adpPlayers: 250, lastAdpRun: { finished_at: old } });

  const detail = await leagueDetail({ leagueId: 1, viewer: 7 }, {});

  assert.equal(detail.league.market.stale, true);
});

test('leagueDetail reports lastSyncAt null and stale true when there is no ADP run at all', async (t) => {
  mockLeagueDetail(t, { adpPlayers: 250, lastAdpRun: null });

  const detail = await leagueDetail({ leagueId: 1, viewer: 7 }, {});

  assert.equal(detail.league.market.lastSyncAt, null);
  assert.equal(detail.league.market.stale, true);
});

// The maintainer applies the data_sync_runs migration as a separate step
// (#747, #748), so a read against it can find the table absent in a given
// environment. That must degrade to the same shape as "no run yet" rather
// than throw (getSchedulerStatus's precedent, modules/scheduler.js).
test('leagueDetail degrades to the no-run market shape when data_sync_runs is absent', async (t) => {
  const tableAbsent = new Error('relation "data_sync_runs" does not exist');
  tableAbsent.code = '42P01';
  mockLeagueDetail(t, { adpPlayers: 250, dataSyncRunsError: tableAbsent });

  const detail = await leagueDetail({ leagueId: 1, viewer: 7 }, {});

  assert.equal(detail.league.market.lastSyncAt, null);
  assert.equal(detail.league.market.stale, true);
});

// 758-f2: decision 3 is "pending drafts only". Gated here, at the module, so
// every consumer of the payload gets the rule for free rather than each
// re-deriving "pending" from draft_status on its own.
for (const draftStatus of ['active', 'complete']) {
  test(`leagueDetail carries no market once draft_status is ${draftStatus}`, async (t) => {
    mockLeagueDetail(t, { draftStatus });

    const detail = await leagueDetail({ leagueId: 1, viewer: 7 }, {});

    assert.equal('market' in detail.league, false);
  });
}

test('leagueDetail carries market while draft_status is pending', async (t) => {
  mockLeagueDetail(t, { draftStatus: 'pending' });

  const detail = await leagueDetail({ leagueId: 1, viewer: 7 }, {});

  assert.equal('market' in detail.league, true);
});

// ---------------------------------------------------------- coded refusals

test('leagueDetail refuses a non-member with a coded 403, message unchanged', async (t) => {
  const fake = createFakePool([
    [/ownerTeamId/, () => ({ rows: [{ id: 1, owner_id: 7, name: 'Sunday Ballers', invite_code: 'invite', ownerTeamId: 11, ownerTeamName: "Alice's Team", draft_status: 'active' }] })],
    // No team row for this viewer: isMember reads empty and the module never
    // reaches the teams query, the market read, or either role read below.
    [/^SELECT 1 FROM "teams"/, () => ({ rows: [] })],
  ]);
  fake.install(t);

  await assert.rejects(
    () => leagueDetail({ leagueId: 1, viewer: 9999 }, {}),
    (error) => {
      assert.ok(error instanceof LeagueDetailError);
      assert.equal(error.statusCode, 403);
      assert.equal(error.code, 'NOT_A_MEMBER');
      assert.equal(error.message, 'not a member of this league');
      return true;
    }
  );
});

test('leagueDetail refuses an unknown league with a coded 404, message unchanged', async (t) => {
  const fake = createFakePool([[/ownerTeamId/, () => ({ rows: [] })]]);
  fake.install(t);

  await assert.rejects(
    () => leagueDetail({ leagueId: 404404, viewer: 7 }, {}),
    (error) => {
      assert.ok(error instanceof LeagueDetailError);
      assert.equal(error.statusCode, 404);
      assert.equal(error.code, 'LEAGUE_NOT_FOUND');
      assert.equal(error.message, 'league not found');
      return true;
    }
  );
});

test('leagueDetail accepts an injected db straight (not only an installed pool)', async (t) => {
  const fake = createFakePool([
    [/ownerTeamId/, () => ({ rows: [{ id: 1, owner_id: 7, name: 'Injected League', invite_code: 'inv', ownerTeamId: null, ownerTeamName: null, draft_status: 'active' }] })],
    [/^SELECT 1 FROM "teams"/, () => ({ rows: [{ '?column?': 1 }] })],
    [/^SELECT 1 FROM "leagues"/, () => ({ rows: [] })],
    [/FROM "league_commissioners"/, () => ({ rows: [] })],
    [/COUNT\("team_players"\."id"\)/, () => ({ rows: [] })],
  ]);

  const detail = await leagueDetail({ leagueId: 1, viewer: 7 }, { db: fake });

  assert.equal(detail.league.name, 'Injected League');
  assert.equal(detail.teams.length, 0);
});
