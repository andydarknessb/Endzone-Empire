const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, insert, select, update } = require('./helpers/fakePool');
const { syncPlayers, NFL_PLAYER_LIST_FLOOR } = require('../services/feedSyncRuns.service');

// Team maintenance in the daily player sync (#2115, ADR 0060): the #1385 departure
// clear, its size floor and kickoff deferral, and the #1391 calendar bound, moved
// here from the injuries job, which now reads ESPN and never touches nfl_team.
// A player ESPN-era `players` row is { id, external_id, name, position, nfl_team };
// every list entry is a Tank01 getNFLPlayerList entry.

const teamCounts = ({ teamChanges, teamsCleared, teamsDeferred }) => ({ teamChanges, teamsCleared, teamsDeferred });
const entry = (playerID, team, extra = {}) => ({ playerID, longName: `Player ${playerID}`, pos: 'WR', team, ...extra });
const CLEAR_STMT = /"nfl_team" = NULL/;

// ---- moves and the blank-team keep ------------------------------------------

test('team refresh: a player the list has moved gets his nfl_team written by the upsert, and is counted', async (t) => {
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({
      rows: [{ id: 1041, external_id: '1041', name: 'Player 1041', position: 'WR', nfl_team: 'ARI' }],
    }), 'client'],
    [insert('players'), () => ({ rows: [] }), 'client'],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await syncPlayers({ season: 2026, api: async () => ({ data: { body: [entry('1041', 'NE')] } }) });

  assert.deepEqual(fake.matching(insert('players'))[0].params[3], ['NE'], 'the upsert carries the list team, not the stored one');
  assert.equal(result.teamChanges, 1, 'the correction is counted for the run record');
  fake.assertClean();
});

test('team refresh: an entry with no team keeps the stored label below the floor, and the upsert cannot null it', async (t) => {
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({
      rows: [{ id: 55, external_id: '55', name: 'Player 55', position: 'WR', nfl_team: 'GB' }],
    }), 'client'],
    [insert('players'), () => ({ rows: [] }), 'client'],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await syncPlayers({ season: 2026, api: async () => ({ data: { body: [entry('55', '')] } }) });

  // The one-entry list is far below the floor. Red-tell: dropping the COALESCE
  // lets the upsert write the list's null over a stored label on any short list.
  assert.match(fake.matching(insert('players'))[0].text, /COALESCE\(EXCLUDED\."nfl_team", "players"\."nfl_team"\)/);
  assert.equal(fake.matching(update('players')).length, 0, 'no clear statement below the floor');
  assert.deepEqual(teamCounts(result), { teamChanges: 0, teamsCleared: 0, teamsDeferred: 0 });
  fake.assertClean();
});

// ---- #1385: departure clears nfl_team, gated on the floor -------------------
// A player who leaves the NFL - dropped from Tank01's list entirely, or listed
// with no team - would keep his last label forever: he looks startable, has no
// game in nfl_games to lock against, and scores 0 with no injury flag. The
// floor keeps the protection for a short or truncated list while letting a
// real, full list's silence about a player read as what it is.

/** `count` filler entries each on SF, matching no stored player, that inflate the list's size. */
function paddingEntries(count) {
  const entries = [];
  for (let i = 0; i < count; i++) entries.push({ playerID: `pad-${i}`, team: 'SF' });
  return entries;
}
const PADDED_ENTRY_COUNT = NFL_PLAYER_LIST_FLOOR;

test('#1385: at or above the floor, a departed player and a blank-team player both clear, a same-team control does not', async (t) => {
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({
      rows: [
        // Absent from the list below - departed.
        { id: 201, external_id: '201', name: 'Player 201', position: 'WR', nfl_team: 'HOU' },
        // Listed with team: '' below - also departed.
        { id: 202, external_id: '202', name: 'Player 202', position: 'WR', nfl_team: 'MIA' },
        // Listed on his stored team - a control, untouched.
        { id: 203, external_id: '203', name: 'Player 203', position: 'WR', nfl_team: 'KC' },
      ],
    }), 'client'],
    // No live league at all, so openKickoffTeams answers the empty set from
    // this one query alone - nothing is deferred (ruling (4')).
    [select('leagues'), () => ({ rows: [] }), 'client'],
    [insert('players'), () => ({ rows: [] }), 'client'],
    [update('players'), () => ({ rows: [] }), 'client'],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await syncPlayers({
    season: 2026,
    api: async () => ({ data: { body: [entry('202', ''), entry('203', 'KC'), ...paddingEntries(PADDED_ENTRY_COUNT)] } }),
  });

  const clear = fake.matching(update('players')).find((c) => CLEAR_STMT.test(c.text));
  assert.deepEqual(clear.params, [[201, 202]], 'the absent and the blank-team player clear in one statement; the control stays');
  assert.deepEqual(teamCounts(result), { teamChanges: 0, teamsCleared: 2, teamsDeferred: 0 });
  fake.assertClean();
});

test('an entry flagged isFreeAgent "True" reads as No NFL team: his stored label clears at or above the floor, a "False" control keeps his', async (t) => {
  // Tank01's list keeps a player who has left the NFL under his LAST team with
  // the flag set (2026-09-15: 1,527 of 3,872 entries; Joe Mixon "team":"HOU"
  // six months after Houston released him).
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({
      rows: [
        { id: 204, external_id: '204', name: 'Player 204', position: 'WR', nfl_team: 'HOU' },
        { id: 205, external_id: '205', name: 'Player 205', position: 'WR', nfl_team: 'KC' },
      ],
    }), 'client'],
    [select('leagues'), () => ({ rows: [] }), 'client'],
    [insert('players'), () => ({ rows: [] }), 'client'],
    [update('players'), () => ({ rows: [] }), 'client'],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await syncPlayers({
    season: 2026,
    api: async () => ({
      data: {
        body: [
          entry('204', 'HOU', { isFreeAgent: 'True' }),
          entry('205', 'KC', { isFreeAgent: 'False' }),
          ...paddingEntries(PADDED_ENTRY_COUNT),
        ],
      },
    }),
  });

  const clear = fake.matching(update('players')).find((c) => CLEAR_STMT.test(c.text));
  assert.deepEqual(clear.params, [[204]]);
  assert.deepEqual(teamCounts(result), { teamChanges: 0, teamsCleared: 1, teamsDeferred: 0 });
  fake.assertClean();
});

test('#1385: below the floor, neither a departed player nor a blank-team player clears', async (t) => {
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({
      rows: [
        { id: 301, external_id: '301', name: 'Player 301', position: 'WR', nfl_team: 'HOU' },
        { id: 302, external_id: '302', name: 'Player 302', position: 'WR', nfl_team: 'MIA' },
        { id: 303, external_id: '303', name: 'Player 303', position: 'WR', nfl_team: 'KC' },
      ],
    }), 'client'],
    [insert('players'), () => ({ rows: [] }), 'client'],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  // 301 omitted and 302 blank, the guard-passed shape, but this list never
  // reaches the floor. No handler answers a clear or a leagues read: an
  // implementation that tried either would fail with "unexpected query".
  const result = await syncPlayers({
    season: 2026,
    api: async () => ({ data: { body: [entry('302', ''), entry('303', 'KC')] } }),
  });

  assert.equal(fake.matching(update('players')).length, 0, 'no clear statement at all below the floor');
  assert.deepEqual(teamCounts(result), { teamChanges: 0, teamsCleared: 0, teamsDeferred: 0 });
  fake.assertClean();
});

// ---- #1385 ruling (4'): a departure defers while its team is mid-lock -----
// Clearing nfl_team for a still-rostered player unlocks him retroactively in
// lineup.service.js's live nfl_team join (risk-001 f1, #627) if his own
// team's current-week game has already kicked off in a live league. The pass
// defers the clear instead - his label stays exactly as stored - and counts
// it in teamsDeferred, distinct from teamsCleared. Ruling's own red-tell.

test("#1385 ruling (4'): a departed player whose team already kicked off in a live league's current week is deferred, not cleared", async (t) => {
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({
      rows: [{ id: 401, external_id: '401', name: 'Player 401', position: 'WR', nfl_team: 'HOU' }],
    }), 'client'],
    [select('leagues'), () => ({ rows: [{ current_season: 2026, current_week: 3 }] }), 'client'],
    // #1391: an empty schedule read for the bound is the "unseen" case in
    // deriveNflWeek - it answers N = 1, so W >= N - 1 holds for ANY W >= 0 and
    // this test's calendar bound is a no-op, unrelated to what it covers.
    [/^SELECT DISTINCT "week", "kickoff_at" FROM "nfl_games"/, () => ({ rows: [] }), 'client'],
    // HOU's week-3 game kicked off an hour ago - the real query's
    // kickoff_at <= NOW() would include it.
    // risk-001-f2 (fakePool handler-order nit): a specific regex on the real
    // kicked-off-teams query's own leading text (fn_normalize_nfl_team), not
    // the generic select('nfl_games') this file used before #1391 added a
    // SECOND "nfl_games" query for the calendar bound - the generic matcher
    // would answer either query, so which one "wins" was really handler
    // ORDER, silently load-bearing and undocumented as such. This regex and
    // the calendar-bound regex above/below never match the same query text,
    // so which is listed first no longer matters.
    [/^SELECT DISTINCT fn_normalize_nfl_team/, () => ({ rows: [{ team: 'HOU' }] }), 'client'],
    [insert('players'), () => ({ rows: [] }), 'client'],
    [update('players'), () => ({ rows: [] }), 'client'],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await syncPlayers({
    season: 2026,
    // 401 omitted - he has left the list - padded past the floor.
    api: async () => ({ data: { body: paddingEntries(PADDED_ENTRY_COUNT) } }),
  });

  assert.equal(
    fake.matching(update('players')).find((c) => /"nfl_team" = NULL/.test(c.text)),
    undefined,
    'no clear statement is issued while his team is mid-lock',
  );
  assert.deepEqual(teamCounts(result), { teamChanges: 0, teamsCleared: 0, teamsDeferred: 1 });
  fake.assertClean();
});

test("#1385 ruling (4'): the same shape clears once his team's current-week game has not kicked off yet", async (t) => {
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({
      rows: [{ id: 402, external_id: '402', name: 'Player 402', position: 'WR', nfl_team: 'HOU' }],
    }), 'client'],
    [select('leagues'), () => ({ rows: [{ current_season: 2026, current_week: 3 }] }), 'client'],
    // #1391: an empty schedule read for the bound answers N = 1, a no-op
    // against W >= N - 1 - unrelated to what this test covers.
    [/^SELECT DISTINCT "week", "kickoff_at" FROM "nfl_games"/, () => ({ rows: [] }), 'client'],
    // HOU's week-3 game kicks off an hour from now - the real query's
    // kickoff_at <= NOW() would exclude it.
    [/^SELECT DISTINCT fn_normalize_nfl_team/, () => ({ rows: [] }), 'client'],
    [insert('players'), () => ({ rows: [] }), 'client'],
    [update('players'), () => ({ rows: [] }), 'client'],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await syncPlayers({
    season: 2026,
    api: async () => ({ data: { body: paddingEntries(PADDED_ENTRY_COUNT) } }),
  });

  const departureWrite = fake.matching(update('players')).find((c) => /"nfl_team" = NULL/.test(c.text));
  assert.deepEqual(departureWrite.params, [[402]], 'he clears once nothing defers him');
  assert.deepEqual(teamCounts(result), { teamChanges: 0, teamsCleared: 1, teamsDeferred: 0 });
  fake.assertClean();
});

test("#1385 ruling (4'): the deferral folds Team code aliases (a stored WSH against nfl_games' folded WAS)", async (t) => {
  // WAS is already its own canonical form (normalizeNflTeam('WAS') === 'WAS'
  // is the identity), so storing WAS on both sides would pass even with the
  // JS-side fold deleted. WSH is the alias that actually needs folding: the
  // player is stored raw WSH, and the nfl_games side answers the ALREADY
  // folded code a raw WAS row would produce (the real SQL applies
  // fn_normalize_nfl_team before this code ever sees the row) - so only the
  // fold on the player's own stored team, at the deferral check itself,
  // makes the two sides match. Deleting that fold sends the raw 'WSH' key
  // against a Set holding only 'WAS' and flips the result to teamsCleared: 1.
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({
      rows: [{ id: 403, external_id: '403', name: 'Player 403', position: 'WR', nfl_team: 'WSH' }],
    }), 'client'],
    [select('leagues'), () => ({ rows: [{ current_season: 2026, current_week: 3 }] }), 'client'],
    // #1391: an empty schedule read for the bound answers N = 1, a no-op
    // against W >= N - 1 - unrelated to what this test covers.
    [/^SELECT DISTINCT "week", "kickoff_at" FROM "nfl_games"/, () => ({ rows: [] }), 'client'],
    [/^SELECT DISTINCT fn_normalize_nfl_team/, () => ({ rows: [{ team: 'WAS' }] }), 'client'],
    [insert('players'), () => ({ rows: [] }), 'client'],
    [update('players'), () => ({ rows: [] }), 'client'],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await syncPlayers({
    season: 2026,
    api: async () => ({ data: { body: paddingEntries(PADDED_ENTRY_COUNT) } }),
  });

  assert.equal(
    fake.matching(update('players')).find((c) => /"nfl_team" = NULL/.test(c.text)),
    undefined,
    'the alias still matches, so the deferral holds',
  );
  assert.deepEqual(teamCounts(result), { teamChanges: 0, teamsCleared: 0, teamsDeferred: 1 });
  fake.assertClean();
});

// ---- #1391 ruling: the (4') deferral is bounded to the NFL calendar -------
// #1385 left "open week" unbounded: a live league's own current_week, with no
// check against the NFL schedule at all. One league whose commissioner never
// advances past week 1 would then pin HOU's departure forever, for every
// league, until that one league's season completed. #1391's ruling bounds it:
// N = deriveNflWeek(getSeasonWeekBounds({season}), now) (pickemSeason.service,
// the same pure function the pick'em lifecycle already uses), and an open
// week (S, W) counts toward the deferral only while W >= N - 1 - the week in
// play and the week just finished, one NFL week of grace. Below that, the
// league holds nobody's label and its clear candidates on that team clear
// normally.
//
// Both tests below share one league (season 2026, current_week 1) and one
// departed player (HOU, already kicked off per the raw nfl_games read) - only
// the schedule-bounds read changes, moving week 2's last kickoff from the
// past to the future so N drops from 3 to 2. That is the whole difference
// between "two weeks behind, cleared" and "one week behind, still deferred".

test("#1391 ruling: a league two or more NFL weeks behind the calendar holds no team's label - the departure clears despite an old kickoff", async (t) => {
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({
      rows: [{ id: 501, external_id: '501', name: 'Player 501', position: 'WR', nfl_team: 'HOU' }],
    }), 'client'],
    // The league's own open week is (2026, 1) - far behind the calendar below.
    [select('leagues'), () => ({ rows: [{ current_season: 2026, current_week: 1 }] }), 'client'],
    // deriveNflWeek's schedule read: week 2's last kickoff is 8h in the past
    // (closed, past the 6h grace) and week 3's kicks off a day from now (open) -
    // the smallest still-open week is 3, so N = 3. The league's open week
    // (W = 1) sits below N - 1 = 2: two calendar weeks behind.
    [/^SELECT DISTINCT "week", "kickoff_at" FROM "nfl_games"/, () => ({
      rows: [
        { week: 2, kickoff_at: new Date(Date.now() - 8 * 60 * 60 * 1000) },
        { week: 3, kickoff_at: new Date(Date.now() + 24 * 60 * 60 * 1000) },
      ],
    }), 'client'],
    [insert('players'), () => ({ rows: [] }), 'client'],
    [update('players'), () => ({ rows: [] }), 'client'],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await syncPlayers({
    season: 2026,
    // 501 omitted - he has left the list - padded past the floor.
    api: async () => ({ data: { body: paddingEntries(PADDED_ENTRY_COUNT) } }),
  });

  // Bounded out of the deferral set: openKickoffTeams never even reads
  // nfl_games for a kicked-off game, since (2026, 1) failed the bound before
  // that query would run - no handler for that query is registered above, so
  // an unbounded implementation would fail here with "unexpected query".
  const departureWrite = fake.matching(update('players')).find((c) => /"nfl_team" = NULL/.test(c.text));
  assert.deepEqual(departureWrite.params, [[501]], 'he clears - his league is too far behind the calendar to hold him');
  assert.deepEqual(teamCounts(result), { teamChanges: 0, teamsCleared: 1, teamsDeferred: 0 });
  fake.assertClean();
});

test('#1391 ruling: one NFL week behind the calendar is still inside the grace - the departure stays deferred', async (t) => {
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({
      rows: [{ id: 502, external_id: '502', name: 'Player 502', position: 'WR', nfl_team: 'HOU' }],
    }), 'client'],
    // Same league, same open week (2026, 1) as the sibling test above.
    [select('leagues'), () => ({ rows: [{ current_season: 2026, current_week: 1 }] }), 'client'],
    // Only week 2's last kickoff moved: now a day AHEAD of now instead of 8h
    // behind, so week 2 is the smallest still-open week - N = 2. The league's
    // open week (W = 1) sits at N - 1 = 1 exactly: one calendar week behind,
    // still inside the grace.
    [/^SELECT DISTINCT "week", "kickoff_at" FROM "nfl_games"/, () => ({
      rows: [{ week: 2, kickoff_at: new Date(Date.now() + 24 * 60 * 60 * 1000) }],
    }), 'client'],
    // HOU's week-1 game (the league's own open week) already kicked off.
    [/^SELECT DISTINCT fn_normalize_nfl_team/, () => ({ rows: [{ team: 'HOU' }] }), 'client'],
    [insert('players'), () => ({ rows: [] }), 'client'],
    [update('players'), () => ({ rows: [] }), 'client'],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await syncPlayers({
    season: 2026,
    api: async () => ({ data: { body: paddingEntries(PADDED_ENTRY_COUNT) } }),
  });

  assert.equal(
    fake.matching(update('players')).find((c) => /"nfl_team" = NULL/.test(c.text)),
    undefined,
    "no clear statement is issued - the bound still holds his league's open week",
  );
  assert.deepEqual(teamCounts(result), { teamChanges: 0, teamsCleared: 0, teamsDeferred: 1 });
  fake.assertClean();
});

// qa-reviewer (#1391 risk review, formal-001-f1): deriveNflWeek saturates at
// REG_SEASON_WEEKS (18) once a season's own calendar has fully closed - its
// own doc comment says it answers 18 both for "week 18 is being played" and
// "everything is over". `W >= N - 1` alone would then hold forever for a
// league parked at week 17 or 18 of a season that finished seasons ago:
// exactly the unbounded pin #1391 exists to remove, surviving at the tail of
// the season.
//
// #1391's season-tail amendment
// (https://github.com/andydarknessb/Endzone-Empire/issues/1391#issuecomment-5680673660):
// a closed season's own LAST week (L) keeps its one week of grace - the same
// grace every other week gets from the week that follows it - measured
// instead from its own last kickoff (T), since it has no following week:
// `W >= L` AND `now < T + 7 days + WEEK_ROLLOVER_GRACE_HOURS` (174 hours).
// Once that instant passes, or for any week short of L, the season holds
// nobody's label. Three red-tell cases, as the ruling states them.

test('#1391 season-tail amendment: a league still on the closed season\'s LAST week, inside its own 174h tail grace, still defers', async (t) => {
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({
      rows: [{ id: 504, external_id: '504', name: 'Player 504', position: 'WR', nfl_team: 'HOU' }],
    }), 'client'],
    // The league never advanced past its championship - it sits at (2025, 18),
    // the season's own last week.
    [select('leagues'), () => ({ rows: [{ current_season: 2025, current_week: 18 }] }), 'client'],
    // Week 18's last kickoff is 2 days past - well inside the 174h tail grace
    // (2 days = 48h < 174h) - so the season reads closed AND the tail is open.
    [/^SELECT DISTINCT "week", "kickoff_at" FROM "nfl_games"/, () => ({
      rows: [{ week: 18, kickoff_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) }],
    }), 'client'],
    // HOU's own week-18 game (the league's open week) already kicked off.
    [/^SELECT DISTINCT fn_normalize_nfl_team/, () => ({ rows: [{ team: 'HOU' }] }), 'client'],
    [insert('players'), () => ({ rows: [] }), 'client'],
    [update('players'), () => ({ rows: [] }), 'client'],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await syncPlayers({
    season: 2026,
    api: async () => ({ data: { body: paddingEntries(PADDED_ENTRY_COUNT) } }),
  });

  assert.equal(
    fake.matching(update('players')).find((c) => /"nfl_team" = NULL/.test(c.text)),
    undefined,
    'no clear statement is issued - the closed season\'s own last week still holds its tail grace',
  );
  assert.deepEqual(teamCounts(result), { teamChanges: 0, teamsCleared: 0, teamsDeferred: 1 });
  fake.assertClean();
});

test('#1391 season-tail amendment: once the tail grace has passed (8 days), the same league clears', async (t) => {
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({
      rows: [{ id: 505, external_id: '505', name: 'Player 505', position: 'WR', nfl_team: 'HOU' }],
    }), 'client'],
    [select('leagues'), () => ({ rows: [{ current_season: 2025, current_week: 18 }] }), 'client'],
    // Week 18's last kickoff is 8 days past - outside the 174h (7.25-day) tail
    // grace - so even the season's own last week no longer holds anybody.
    [/^SELECT DISTINCT "week", "kickoff_at" FROM "nfl_games"/, () => ({
      rows: [{ week: 18, kickoff_at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) }],
    }), 'client'],
    [insert('players'), () => ({ rows: [] }), 'client'],
    [update('players'), () => ({ rows: [] }), 'client'],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await syncPlayers({
    season: 2026,
    // 505 omitted - he has left the list - padded past the floor.
    api: async () => ({ data: { body: paddingEntries(PADDED_ENTRY_COUNT) } }),
  });

  // No handler above answers a kicked-off-teams read: the tail grace expired,
  // so (2025, 18) never reaches that query.
  const departureWrite = fake.matching(update('players')).find((c) => /"nfl_team" = NULL/.test(c.text));
  assert.deepEqual(departureWrite.params, [[505]], 'he clears - the season\'s own tail grace has passed');
  assert.deepEqual(teamCounts(result), { teamChanges: 0, teamsCleared: 1, teamsDeferred: 0 });
  fake.assertClean();
});

test("#1391 season-tail amendment: a league on week 17 once week 18 has closed is two weeks behind and clears, even inside week 18's own tail grace", async (t) => {
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({
      rows: [{ id: 506, external_id: '506', name: 'Player 506', position: 'WR', nfl_team: 'HOU' }],
    }), 'client'],
    // A commissioner never clicked advance on the championship - the league
    // sits at (2025, 17), one week short of the season's own last week (18).
    [select('leagues'), () => ({ rows: [{ current_season: 2025, current_week: 17 }] }), 'client'],
    // Week 18's last kickoff is 2 days past - inside ITS OWN tail grace - but
    // this league's open week (17) is still short of L (18), so the tail
    // grace never applies to it regardless.
    [/^SELECT DISTINCT "week", "kickoff_at" FROM "nfl_games"/, () => ({
      rows: [{ week: 18, kickoff_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) }],
    }), 'client'],
    [insert('players'), () => ({ rows: [] }), 'client'],
    [update('players'), () => ({ rows: [] }), 'client'],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await syncPlayers({
    season: 2026,
    // 506 omitted - he has left the list - padded past the floor.
    api: async () => ({ data: { body: paddingEntries(PADDED_ENTRY_COUNT) } }),
  });

  // No handler above answers a kicked-off-teams read: W=17 < L=18 excludes
  // this row before the tail-grace check even matters.
  const departureWrite = fake.matching(update('players')).find((c) => /"nfl_team" = NULL/.test(c.text));
  assert.deepEqual(departureWrite.params, [[506]], 'he clears - his league is a week short of the season\'s own last week');
  assert.deepEqual(teamCounts(result), { teamChanges: 0, teamsCleared: 1, teamsDeferred: 0 });
  fake.assertClean();
});

// ---- #1789: the availability reconcile follows a team write ------------------

const SAVEPOINT_STMT = /^SAVEPOINT reconcile_availability$/;
const RELEASE_STMT = /^RELEASE SAVEPOINT reconcile_availability$/;
const ROLLBACK_TO_STMT = /^ROLLBACK TO SAVEPOINT reconcile_availability$/;

test('#1789: a team move and a clear reconcile availability for exactly those ids, on the transaction client, after the writes', async (t) => {
  const projection = require('../services/projection.service');
  let reconcileArgs = null;
  t.mock.method(projection, 'liveReconcileScope', async () => ({ season: 2026, fromWeek: 4 }));
  t.mock.method(projection, 'reconcileAvailability', async (args) => { reconcileArgs = args; return { checked: 2, updated: 2 }; });
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({
      rows: [
        { id: 601, external_id: '601', name: 'Player 601', position: 'WR', nfl_team: 'ARI' }, // moves to NE
        { id: 602, external_id: '602', name: 'Player 602', position: 'WR', nfl_team: 'BUF' }, // departs
        { id: 603, external_id: '603', name: 'Player 603', position: 'WR', nfl_team: 'KC' }, // control
      ],
    }), 'client'],
    [select('leagues'), () => ({ rows: [] }), 'client'],
    [insert('players'), () => ({ rows: [] }), 'client'],
    [update('players'), () => ({ rows: [] }), 'client'],
    [SAVEPOINT_STMT, () => ({ rows: [] }), 'client'],
    [RELEASE_STMT, () => ({ rows: [] }), 'client'],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const now = new Date('2026-10-08T12:00:00Z');
  await syncPlayers({
    season: 2026,
    now,
    api: async () => ({ data: { body: [entry('601', 'NE'), entry('603', 'KC'), ...paddingEntries(PADDED_ENTRY_COUNT)] } }),
  });

  assert.deepEqual(reconcileArgs.playerIds, [601, 602], 'the moved and the cleared player, never the control');
  assert.equal(reconcileArgs.now, now);
  assert.equal(fake.calls.find((c) => SAVEPOINT_STMT.test(c.text)).via, 'client');
  const clearIdx = fake.calls.findIndex((c) => CLEAR_STMT.test(c.text));
  const savepointIdx = fake.calls.findIndex((c) => SAVEPOINT_STMT.test(c.text));
  assert.ok(clearIdx >= 0 && clearIdx < savepointIdx, 'the reconcile follows the clear');
  fake.assertClean();
});

test('#1789: a run that moves and clears nobody never reconciles; a reconcile failure rolls back to its savepoint and never fails the sync', async (t) => {
  const projection = require('../services/projection.service');
  let calls = 0;
  t.mock.method(projection, 'liveReconcileScope', async () => ({ season: 2026, fromWeek: 4 }));
  t.mock.method(projection, 'reconcileAvailability', async () => { calls += 1; throw new Error('reconcile blew up'); });
  const quiet = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({ rows: [{ id: 1, external_id: '1', name: 'Player 1', position: 'WR', nfl_team: 'KC' }] }), 'client'],
    [insert('players'), () => ({ rows: [] }), 'client'],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);
  await syncPlayers({ season: 2026, api: async () => ({ data: { body: [entry('1', 'KC')] } }) });
  assert.equal(calls, 0, 'nothing changed: no reconcile');
  assert.equal(quiet.calls.some((c) => SAVEPOINT_STMT.test(c.text)), false);

  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({ rows: [{ id: 2, external_id: '2', name: 'Player 2', position: 'WR', nfl_team: 'ARI' }] }), 'client'],
    [insert('players'), () => ({ rows: [] }), 'client'],
    [SAVEPOINT_STMT, () => ({ rows: [] }), 'client'],
    [ROLLBACK_TO_STMT, () => ({ rows: [] }), 'client'],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);
  t.mock.method(console, 'error', () => {});
  const result = await syncPlayers({ season: 2026, api: async () => ({ data: { body: [entry('2', 'NE')] } }) });
  assert.equal(result.teamChanges, 1);
  assert.ok(fake.calls.some((c) => ROLLBACK_TO_STMT.test(c.text)), 'the failed reconcile rolls back to its own savepoint');
  assert.ok(fake.calls.some((c) => c.text === 'COMMIT'), 'the team write still commits');
});
