const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, select, insert } = require('./helpers/fakePool');
const push = require('../services/push.service');
const clock = require('../modules/clock');
const { sendAlert } = require('../services/pushAlerts.service');
const { banterFor, SITUATIONS } = require('../services/pushBanter');

// The fake pool models what the module reads and writes: notification_prefs
// (usersWanting), and push_events as a unique ledger whose rows carry the
// pinned clock's created_at. `ledger` can be handed to a second world to stand
// in for a process restart: the memory is gone, the table is not. `handlers`
// answer each kind's own recipient SQL and go first.
function world(t, { prefs = {}, ledger = [], handlers = [], now = '2026-10-11T18:00:00Z' } = {}) {
  const state = { now: new Date(now), ledger, sent: [], written: [] };
  t.mock.method(clock, 'now', () => state.now);
  const fake = createFakePool([
    ...handlers,
    [/^SELECT "user_id", "prefs" FROM "notification_prefs"/, (text, [ids]) => ({
      rows: ids.filter((id) => prefs[id]).map((id) => ({ user_id: id, prefs: prefs[id] })),
    })],
    // waiver-results: the newest row's fingerprint for the league.
    [/^SELECT "fingerprint" FROM "push_events" WHERE "kind" = 'waiver-results'/, (text, [subject]) => {
      const last = state.ledger.filter((r) => r.kind === 'waiver-results' && r.subject === subject).pop();
      return { rows: last ? [{ fingerprint: last.fingerprint }] : [] };
    }],
    // score-lead: the owner's latest row for the matchup.
    [/^SELECT "fingerprint" FROM "push_events" WHERE "user_id"/, (text, [userId, subject]) => {
      const last = state.ledger.filter((r) => r.user_id === userId && r.kind === 'score-lead' && r.subject === subject).pop();
      return { rows: last ? [{ fingerprint: last.fingerprint }] : [] };
    }],
    // The rate rule: a row for this user and kind inside the window.
    [/^SELECT 1 FROM "push_events"/, (text, [userId, kind, cutoff, notLike]) => ({
      rows: state.ledger.some((r) => r.user_id === userId && r.kind === kind && r.created_at > cutoff
        && !(notLike === '%:0' && r.fingerprint.endsWith(':0')))
        ? [{ '?column?': 1 }] : [],
    })],
    // The ledger insert (userId, kind, subject, fingerprint) and score-lead's
    // silent record (userId, subject, fingerprint) with a literal kind.
    [insert('push_events'), (text, params) => {
      const [user_id, kind, subject, fingerprint] = params.length === 4 ? params : [params[0], 'score-lead', params[1], params[2]];
      if (state.ledger.some((r) => r.user_id === user_id && r.kind === kind && r.subject === subject && r.fingerprint === fingerprint)) {
        return { rows: [] };
      }
      state.ledger.push({ user_id, kind, subject, fingerprint, created_at: state.now });
      if (params.length === 4) state.written.push(params);
      return { rows: [{ user_id }] };
    }],
  ]).install(t);
  t.mock.method(push, 'sendPushToUsers', async (userIds, payload) => {
    state.sent.push({ userIds, payload });
    return { sent: userIds.length };
  });
  state.fake = fake;
  state.inserts = () => state.written;
  state.advance = (minutes) => { state.now = new Date(state.now.getTime() + minutes * 60 * 1000); };
  return state;
}

const to = (state) => state.sent.map((s) => s.userIds[0]);
const off = (key) => ({ [key]: false });

// ---------------------------------------------------------------- big-play

// Matchup 100: team 1 (owner 11) vs team 2 (owner 22). Players 501 and 601 start
// for the home team, 502 sits on its bench, 701 starts for the away team.
const LINEUP = [
  { team_id: 1, player_id: 501, slot: 'WR' },
  { team_id: 1, player_id: 601, slot: 'RB' },
  { team_id: 1, player_id: 502, slot: 'BENCH' },
  { team_id: 2, player_id: 701, slot: 'WR' },
];
const BIG_HANDLERS = [
  [select('leagues'), () => ({ rows: [{ id: 42, scoring_rules: null }] })],
  [select('lineup_entries'), (text, [teamIds, , , playerIds]) => ({
    rows: LINEUP.filter((r) => teamIds.includes(r.team_id) && playerIds.includes(r.player_id)
      && !['BENCH', 'IR'].includes(r.slot)),
  })],
  [select('teams'), () => ({ rows: [{ id: 1, owner_id: 11 }, { id: 2, owner_id: 22 }] })],
  [select('player_stats'), () => ({ rows: [] })],
];
const SCORED = [{ matchupId: 100, homeTeamId: 1, awayTeamId: 2, homeScore: 50, awayScore: 40 }];
const play = (over) => ({ playerId: 501, name: 'Home Wideout', type: 'receiving', tdDelta: 1, pointsDelta: 6, isTouchdown: true, ...over });
const bigPlay = (plays) => sendAlert({ kind: 'big-play', leagueId: 42, season: 2026, week: 5, scored: SCORED, plays });

test('big-play: both owners of the matchup, gated by touchdownCelebrations, ledgered by matchup and fingerprint', async (t) => {
  const state = world(t, { handlers: BIG_HANDLERS, prefs: { 22: off('touchdownCelebrations') } });

  const result = await bigPlay([play()]);

  assert.deepEqual(to(state), [11], 'the owner with the pref off is not sent');
  assert.deepEqual(state.inserts(), [[11, 'big-play', '100', '501:receivingTDs:1']], 'and writes no row');
  const payload = state.sent[0].payload;
  assert.equal(payload.title, 'Big play: Home Wideout receiving touchdown');
  assert.equal(payload.body, 'Home Wideout receiving touchdown (6 pts, yours)');
  assert.equal(payload.url, '/#/league/42/game-center');
  assert.equal(payload.banter, banterFor('bigPlayMine', 'big-play:100:501:receivingTDs:1', { player: 'Home Wideout', event: 'receiving touchdown', points: 6 }));
  assert.deepEqual([result.sent, result.skipped, result.fresh.map((r) => r.userId)], [1, 1, [11]]);
});

test('big-play: the opponent reads "your opponent\'s" with the bigPlayTheirs Banter', async (t) => {
  const state = world(t, { handlers: BIG_HANDLERS });

  await bigPlay([play()]);

  assert.deepEqual(to(state), [11, 22]);
  assert.equal(state.sent[1].payload.body, "Home Wideout receiving touchdown (6 pts, your opponent's)");
  assert.equal(state.sent[1].payload.banter, banterFor('bigPlayTheirs', 'big-play:100:501:receivingTDs:1', { player: 'Home Wideout', event: 'receiving touchdown', points: 6 }));
});

test('big-play: two qualifying plays give each owner one push titled "2 big plays"', async (t) => {
  const state = world(t, { handlers: BIG_HANDLERS });

  await bigPlay([play(), play({ playerId: 701, name: 'Away Wideout' })]);

  assert.equal(state.sent.length, 2);
  for (const s of state.sent) assert.equal(s.payload.title, '2 big plays');
  assert.deepEqual(state.sent[0].payload.body.split('\n'), [
    'Home Wideout receiving touchdown (6 pts, yours)',
    "Away Wideout receiving touchdown (6 pts, your opponent's)",
  ]);
  assert.equal(state.inserts()[0][3], '501:receivingTDs:1,701:receivingTDs:1');
  assert.equal(state.sent[0].payload.banter, banterFor('bigPlaySeveral', 'big-play:100:501:receivingTDs:1,701:receivingTDs:1', { count: 2 }));
});

test('big-play: a bench TD, a field goal and a played or final matchup send nothing', async (t) => {
  const state = world(t, { handlers: BIG_HANDLERS });

  await bigPlay([play({ playerId: 502 })]);
  await bigPlay([play({ type: 'fieldGoal', pointsDelta: 3, isTouchdown: false })]);
  for (const status of ['played', 'final']) {
    await sendAlert({ kind: 'big-play', leagueId: 42, season: 2026, week: 5, scored: [{ ...SCORED[0], status }], plays: [play()] });
  }

  assert.deepEqual(state.sent, []);
  assert.deepEqual(state.ledger, []);
});

test('big-play: BIG_PLAY_MIN_POINTS raises the threshold', async (t) => {
  const state = world(t, { handlers: BIG_HANDLERS });
  process.env.BIG_PLAY_MIN_POINTS = '7';
  t.after(() => { delete process.env.BIG_PLAY_MIN_POINTS; });

  await bigPlay([play()]);

  assert.deepEqual(state.sent, []);
});

test('big-play: 5-minute cap per owner; a capped owner writes no row and the dropped play is not queued', async (t) => {
  const state = world(t, { handlers: BIG_HANDLERS });
  await bigPlay([play()]);
  assert.equal(state.sent.length, 2);

  state.advance(2);
  const capped = await bigPlay([play({ playerId: 601, name: 'Second Back', type: 'rushing' })]);
  assert.equal(state.sent.length, 2, 'inside the five-minute cap the play is dropped');
  assert.equal(state.ledger.length, 2, 'a capped recipient writes no row');
  assert.deepEqual([capped.sent, capped.skipped, capped.fresh], [0, 2, []]);

  state.advance(4);
  await bigPlay([play({ playerId: 601, name: 'Second Back', type: 'rushing' })]);
  assert.equal(state.sent.length, 4, 'six minutes on, the same play sends');
  assert.equal(state.sent[2].payload.title, 'Big play: Second Back rushing touchdown');
});

test('big-play: the same play twice sends once', async (t) => {
  const state = world(t, { handlers: BIG_HANDLERS });

  await bigPlay([play()]);
  state.advance(10);
  await bigPlay([play()]);

  assert.deepEqual(to(state), [11, 22]);
});

// ------------------------------------------------- score-lead, score-played

// Team 3 (owner 11) is home, team 4 (owner 22) is away, matchup 987.
const SCORE_HANDLERS = [
  [select('teams'), () => ({
    rows: [{ id: 3, name: 'Home FC', owner_id: 11 }, { id: 4, name: 'Away FC', owner_id: 22 }],
  })],
];
const HOME = { mine: 'Home FC', theirs: 'Away FC' };
const AWAY = { mine: 'Away FC', theirs: 'Home FC' };
const scored = (kind, state) => (homeScore, awayScore, status = 'live') => sendAlert({
  kind, leagueId: 42, season: 2026, week: 7,
  scored: [{ matchupId: 987, homeTeamId: 3, awayTeamId: 4, homeScore, awayScore, status }],
});

test('score-lead: the first scoring records the leader silently; a lead change pushes each owner with ledger home:1 / away:1', async (t) => {
  const state = world(t, { handlers: SCORE_HANDLERS });
  const call = scored('score-lead');

  assert.deepEqual(await call(10, 5), { sent: 0, skipped: 0, fresh: [] });
  assert.deepEqual(state.sent, []);
  assert.deepEqual(state.ledger.map((r) => [r.user_id, r.subject, r.fingerprint]), [[11, '987', 'home:0'], [22, '987', 'home:0']]);

  state.advance(1);
  await call(12, 15);

  assert.deepEqual(state.sent.map((s) => [s.userIds[0], s.payload.title]), [[11, 'You lost the lead'], [22, 'You took the lead']]);
  assert.equal(state.sent[0].payload.body, 'Home FC 12.0 - Away FC 15.0');
  assert.equal(state.sent[1].payload.body, 'Away FC 15.0 - Home FC 12.0');
  assert.equal(state.sent[0].payload.url, '/#/league/42/game-center');
  assert.equal(state.sent[0].payload.banter, banterFor('leadLost', 'score-lead:987:away:1', HOME));
  assert.equal(state.sent[1].payload.banter, banterFor('leadTaken', 'score-lead:987:away:1', AWAY));
  assert.deepEqual(state.inserts(), [[11, 'score-lead', '987', 'away:1'], [22, 'score-lead', '987', 'away:1']]);

  await call(12, 16);
  assert.equal(state.sent.length, 2, 'the same leader again pushes nothing');
});

test('score-lead: a tie reads "Tied up" for both owners', async (t) => {
  const state = world(t, { handlers: SCORE_HANDLERS });
  const call = scored('score-lead');

  await call(10, 5);
  await call(10, 10);

  assert.deepEqual(state.sent.map((s) => s.payload.title), ['Tied up', 'Tied up']);
  assert.equal(state.sent[0].payload.banter, banterFor('tied', 'score-lead:987:tied:1', HOME));
});

test('score-lead: scoreUpdates off sends nothing to that owner and writes no push row; the silent record is still written', async (t) => {
  const state = world(t, { handlers: SCORE_HANDLERS, prefs: { 22: off('scoreUpdates') } });
  const call = scored('score-lead');

  await call(10, 5);
  await call(10, 15);

  assert.deepEqual(to(state), [11]);
  // Known drift (ADR 0064 PR note): the pref gate runs after the recipients, so
  // the silent ':0' record exists for the owner with the pref off.
  assert.deepEqual(state.ledger.map((r) => [r.user_id, r.fingerprint]).sort(), [[11, 'home:0'], [11, 'away:1'], [22, 'home:0']].sort());
});

test('score-lead: a final or played matchup sends nothing', async (t) => {
  const state = world(t, { handlers: SCORE_HANDLERS });
  const call = scored('score-lead');
  await call(10, 5);

  await call(10, 15, 'final');
  await call(10, 15, 'played');

  assert.deepEqual(state.sent, []);
});

test('score-lead: 5-minute cap per owner; a capped flip writes no row and sends once the cap lapses', async (t) => {
  const state = world(t, { handlers: SCORE_HANDLERS });
  const call = scored('score-lead');

  await call(10, 5); // silent
  state.advance(10);
  await call(12, 15); // away: pushed, starts the cap
  assert.equal(state.sent.length, 2);

  state.advance(2);
  const capped = await call(20, 15); // flips back inside the cap
  assert.equal(state.sent.length, 2);
  assert.equal(state.ledger.filter((r) => r.fingerprint.startsWith('home:') && !r.fingerprint.endsWith(':0')).length, 0, 'no row for a capped change');
  assert.deepEqual([capped.sent, capped.skipped], [0, 2]);

  state.advance(4);
  await call(20, 15);
  assert.deepEqual(state.sent.slice(2).map((s) => [s.userIds[0], s.payload.title]), [[11, 'You took the lead'], [22, 'You lost the lead']]);
  assert.deepEqual(state.inserts().slice(2), [[11, 'score-lead', '987', 'home:2'], [22, 'score-lead', '987', 'home:2']]);
});

test('score-lead: scores that round to the same figure print two decimals', async (t) => {
  const state = world(t, { handlers: SCORE_HANDLERS });
  const call = scored('score-lead');

  await call(10, 5);
  await call(100.2, 100.24);

  assert.equal(state.sent[0].payload.body, 'Home FC 100.20 - Away FC 100.24');
  assert.equal(state.sent[1].payload.body, 'Away FC 100.24 - Home FC 100.20');
});

test('score-played: the Final push goes to each owner once, with the result, score and Banter', async (t) => {
  const state = world(t, { handlers: SCORE_HANDLERS });
  const call = scored('score-played');

  assert.deepEqual(await call(100.25, 90, 'live'), { sent: 0, skipped: 0, fresh: [] });
  await call(100.25, 90, 'played');
  await call(100.25, 90, 'played');

  assert.deepEqual(state.sent.map((s) => [s.userIds[0], s.payload.title]), [[11, 'Final: you won 100.3-90.0'], [22, 'Final: you lost 90.0-100.3']]);
  assert.equal(state.sent[0].payload.body, 'Unofficial until the commissioner advances the week. Home FC 100.3 - Away FC 90.0');
  assert.equal(state.sent[0].payload.url, '/#/league/42/game-center');
  assert.equal(state.sent[0].payload.banter, banterFor('finalWon', 'score-played:987:played', HOME));
  assert.equal(state.sent[1].payload.banter, banterFor('finalLost', 'score-played:987:played', AWAY));
  assert.deepEqual(state.inserts(), [[11, 'score-played', '987', 'played'], [22, 'score-played', '987', 'played']]);
});

test('score-played: a loss by under a point is finalLostClose, a tie is finalTied, a final or live matchup sends nothing, scoreUpdates off is skipped, and the push is never rate-capped', async (t) => {
  const close = world(t, { handlers: SCORE_HANDLERS, prefs: { 11: off('scoreUpdates') } });
  await scored('score-played')(10.5, 10, 'played');
  assert.deepEqual(to(close), [22]);
  assert.equal(close.sent[0].payload.banter, banterFor('finalLostClose', 'score-played:987:played', AWAY));
  assert.deepEqual(close.inserts(), [[22, 'score-played', '987', 'played']]);

  const tie = world(t, { handlers: SCORE_HANDLERS });
  await scored('score-played')(10, 10, 'played');
  assert.equal(tie.sent[0].payload.banter, banterFor('finalTied', 'score-played:987:played', HOME));
  assert.equal(tie.sent[0].payload.title, 'Final: tied 10.00-10.00');

  const final = world(t, { handlers: SCORE_HANDLERS });
  await scored('score-played')(10, 5, 'final');
  assert.deepEqual(final.sent, []);

  // A lead push a minute ago does not cap the Final push.
  const capped = world(t, { handlers: SCORE_HANDLERS });
  await scored('score-lead')(10, 5);
  capped.advance(10);
  await scored('score-lead')(10, 15);
  capped.advance(1);
  await scored('score-played')(10, 15, 'played');
  assert.deepEqual(capped.sent.slice(2).map((s) => s.payload.title), ['Final: you lost 10.0-15.0', 'Final: you won 15.0-10.0']);
});

// ----------------------------------------------------------- close-matchup

const CLOSE_HANDLERS = [[select('teams'), () => ({ rows: [{ owner_id: 11 }, { owner_id: 22 }] })]];
const CLOSE = { matchupId: 987, homeTeamId: 3, awayTeamId: 4, homeScore: 80.04, awayScore: 77.5 };
const close = (rows = [CLOSE]) => sendAlert({ kind: 'close-matchup', leagueId: 42, week: 7, scored: rows });

test('close-matchup: both owners of a matchup within 10 points, gated by closeMatchups, ledgered by matchup and week', async (t) => {
  const state = world(t, { handlers: CLOSE_HANDLERS, prefs: { 22: off('closeMatchups') } });

  const result = await close();

  assert.deepEqual(to(state), [11]);
  assert.deepEqual(state.inserts(), [[11, 'close-matchup', '987:7', 'close']]);
  assert.deepEqual(state.sent[0].payload, {
    title: 'Your matchup is close!',
    body: 'Week 7: separated by just 2.5 points. Keep watching.',
    url: '/#/league/42/game-center',
    banter: banterFor('closeMatchup', 'close:987:7', { margin: 2.5, week: 7 }),
  });
  assert.deepEqual([result.sent, result.skipped], [1, 1]);
});

test('close-matchup: a 10-point margin qualifies, 10.5 does not, and a zero-score side does not', async (t) => {
  const state = world(t, { handlers: CLOSE_HANDLERS });

  await close([{ ...CLOSE, homeScore: 90, awayScore: 79.5 }]);
  assert.deepEqual(state.sent, []);
  await close([{ ...CLOSE, homeScore: 0, awayScore: 0 }]);
  await close([{ ...CLOSE, homeScore: 5, awayScore: 0 }]);
  assert.deepEqual(state.sent, []);
  await close([{ ...CLOSE, homeScore: 90, awayScore: 80 }]);

  assert.deepEqual(to(state), [11, 22]);
  assert.match(state.sent[0].payload.body, /separated by just 10 points/);
});

test('close-matchup: sending the same close matchup twice sends once', async (t) => {
  const state = world(t, { handlers: CLOSE_HANDLERS });

  await close();
  const second = await close();

  assert.deepEqual(to(state), [11, 22]);
  assert.deepEqual([second.sent, second.skipped, second.fresh], [0, 2, []]);
});

test('close-matchup: a restart does not repeat the alert (a second world holding the first ledger sends nothing)', async (t) => {
  const first = world(t, { handlers: CLOSE_HANDLERS });
  await close();
  assert.equal(first.sent.length, 2);

  const second = world(t, { handlers: CLOSE_HANDLERS, ledger: first.ledger });
  await close();

  assert.deepEqual(second.sent, []);
});

test('close-matchup: the next week of the same matchup id is a new alert', async (t) => {
  const state = world(t, { handlers: CLOSE_HANDLERS });

  await close();
  await sendAlert({ kind: 'close-matchup', leagueId: 42, week: 8, scored: [CLOSE] });

  assert.equal(state.sent.length, 4);
});

// ------------------------------------------------------------------ injury

const INJURY_ROWS = [
  { player_id: 5, league_id: 1, owner_id: 11, name: 'Star Back', injury_detail: 'Hamstring' },
  { player_id: 5, league_id: 2, owner_id: 11, name: 'Star Back', injury_detail: 'Hamstring' },
  { player_id: 5, league_id: 2, owner_id: 22, name: 'Star Back', injury_detail: 'Hamstring' },
  { player_id: 5, league_id: 3, owner_id: 33, name: 'Star Back', injury_detail: 'Hamstring' },
];
const INJURY_HANDLERS = [[/FROM "team_players" tp/, () => ({ rows: INJURY_ROWS })]];
const injury = (designation, day = '2026-10-11') => sendAlert({
  kind: 'injury', changes: [{ playerId: 5, currentDesignation: designation }], day,
});

test('injury: each rostering manager once, to his first league\'s lineup page, gated by injuryAlerts, ledgered by player and label:day', async (t) => {
  const state = world(t, { handlers: INJURY_HANDLERS, prefs: { 33: off('injuryAlerts') } });

  const result = await injury('Q');

  assert.deepEqual(state.sent.map((s) => [s.userIds[0], s.payload]), [
    [11, { title: 'Star Back is now Questionable', body: 'Hamstring', url: '/#/league/1/lineup' }],
    [22, { title: 'Star Back is now Questionable', body: 'Hamstring', url: '/#/league/2/lineup' }],
  ]);
  assert.deepEqual(state.inserts(), [
    [11, 'injury', '5', 'Questionable:2026-10-11'],
    [22, 'injury', '5', 'Questionable:2026-10-11'],
  ]);
  assert.deepEqual([result.sent, result.skipped], [2, 1]);
});

test('injury: designation labels, "healthy" for an unknown one, and an empty body without detail', async (t) => {
  const state = world(t, { handlers: [[/FROM "team_players" tp/, () => ({ rows: [{ ...INJURY_ROWS[0], injury_detail: null }] })]] });

  for (const [code, label] of [['D', 'Doubtful'], ['O', 'Out'], ['IR', 'IR'], [null, 'healthy']]) {
    await injury(code);
    assert.equal(state.sent.at(-1).payload.title, `Star Back is now ${label}`);
  }
  assert.equal(state.sent.at(-1).payload.body, '');
});

test('injury: no changes makes no query; a repeat of the same state sends once and a changed designation sends again', async (t) => {
  const state = world(t, { handlers: INJURY_HANDLERS });

  assert.deepEqual(await sendAlert({ kind: 'injury', changes: [], day: '2026-10-11' }), { sent: 0, skipped: 0, fresh: [] });
  assert.equal(state.fake.calls.length, 0);

  await injury('Q');
  await injury('Q');
  assert.equal(state.sent.length, 3, 'three managers, one each');
  await injury('O');
  assert.equal(state.sent.length, 6);
  await injury('O', '2026-10-12');
  assert.equal(state.sent.length, 9, 'the same state on a new day is a new push');
});

// --------------------------------------------------------------- ir-action

test('ir-action: one push per flag, gated by irAlerts, with no ledger row', async (t) => {
  const state = world(t, { prefs: { 22: off('irAlerts') } });
  const flags = [
    { userId: 11, leagueId: 1, message: 'Star Back is back from IR. Activate or drop.' },
    { userId: 11, leagueId: 2, message: 'Other Back is back from IR. Activate or drop.' },
    { userId: 22, leagueId: 2, message: 'Skipped.' },
  ];

  const result = await sendAlert({ kind: 'ir-action', flags });

  assert.deepEqual(state.sent.map((s) => [s.userIds, s.payload]), [
    [[11], { title: 'IR roster action required', body: 'Star Back is back from IR. Activate or drop.', url: '/#/league/1/lineup' }],
    [[11], { title: 'IR roster action required', body: 'Other Back is back from IR. Activate or drop.', url: '/#/league/2/lineup' }],
  ]);
  assert.equal(state.fake.matching(insert('push_events')).length, 0);
  assert.deepEqual([result.sent, result.skipped], [2, 1]);
  assert.deepEqual(await sendAlert({ kind: 'ir-action', flags: [] }), { sent: 0, skipped: 0, fresh: [] });
});

// --------------------------------------------------------- lineup-reminder

const lineup = (over) => sendAlert({
  kind: 'lineup-reminder', leagueId: 42, team: { id: 7, owner_id: 9 }, season: 2026, week: 9,
  problems: ['QB is Out', '1 empty slot'], ...over,
});

test('lineup-reminder: the team owner, gated by lineupReminder, ledgered by team-season-week, with the lineupProblem Banter', async (t) => {
  const state = world(t);

  const result = await lineup();

  assert.deepEqual(state.sent, [{
    userIds: [9],
    payload: {
      title: 'Set your lineup before kickoff',
      body: 'Lineup check for week 9: QB is Out; 1 empty slot',
      url: '/#/league/42/lineup',
      banter: banterFor('lineupProblem', 'lineup-reminder:7:2026:9:sent', { week: 9 }),
    },
  }]);
  assert.deepEqual(state.inserts(), [[9, 'lineup-reminder', '7:2026:9', 'sent']]);
  assert.deepEqual([result.sent, result.skipped, result.fresh.map((r) => r.userId)], [1, 0, [9]]);

  const again = await lineup();
  assert.deepEqual([again.sent, again.skipped, again.fresh], [0, 1, []]);
  assert.equal(state.sent.length, 1);
});

test('lineup-reminder: lineupReminder off sends nothing, writes no row and returns no fresh recipient', async (t) => {
  const state = world(t, { prefs: { 9: off('lineupReminder') } });

  const result = await lineup();

  assert.deepEqual([result.sent, result.skipped, result.fresh], [0, 1, []]);
  assert.deepEqual(state.sent, []);
  assert.equal(state.fake.matching(insert('push_events')).length, 0);
});

// --------------------------------------------------------- pickem-reminder

const pickem = (over) => sendAlert({
  kind: 'pickem-reminder', league: { id: 5, season: 2026, week: 9 }, member: { owner_id: 9 }, missing: 3, ...over,
});

test('pickem-reminder: the member, gated by pickemReminder, ledgered by league-season-week, singular and plural copy', async (t) => {
  const state = world(t);

  const result = await pickem();
  await pickem({ league: { id: 6, season: 2026, week: 9 }, missing: 1 });

  assert.deepEqual(state.sent[0], {
    userIds: [9],
    payload: {
      title: "Make your Pick'em picks before kickoff",
      body: "Week 9 Pick'em: 3 games still unpicked before kickoff.",
      url: '/#/league/5/pickem',
    },
  });
  assert.equal(state.sent[1].payload.body, "Week 9 Pick'em: 1 game still unpicked before kickoff.");
  assert.equal('banter' in state.sent[0].payload, false);
  assert.deepEqual(state.inserts(), [[9, 'pickem-reminder', '5:2026:9', 'sent'], [9, 'pickem-reminder', '6:2026:9', 'sent']]);
  assert.deepEqual(result.fresh.map((r) => r.userId), [9]);
});

test('pickem-reminder: pickemReminder off sends nothing and writes no row', async (t) => {
  const state = world(t, { prefs: { 9: off('pickemReminder') } });

  const result = await pickem();

  assert.deepEqual([result.sent, result.fresh], [0, []]);
  assert.equal(state.fake.matching(insert('push_events')).length, 0);
});

test('pickem-reminder: a restart does not repeat the reminder', async (t) => {
  const first = world(t);
  await pickem();
  assert.equal(first.sent.length, 1);

  const second = world(t, { ledger: first.ledger });
  const result = await pickem();

  assert.deepEqual(second.sent, []);
  assert.deepEqual(result.fresh, []);
});

// ---------------------------------------------------------- waiver-results

const CLAIMS = [
  { status: 'won', note: null, bid: 12, processed_at: new Date('2026-10-11T17:30:00.450Z'), player_name: 'Sleeper WR', owner_id: 11, email: 'a@x.test', league_name: 'Lg One' },
  { status: 'lost', note: 'outbid', bid: 0, processed_at: new Date('2026-10-11T17:30:00.450Z'), player_name: 'Other WR', owner_id: 11, email: 'a@x.test', league_name: 'Lg One' },
  { status: 'lost', note: null, bid: 3, processed_at: new Date('2026-10-11T17:31:00.000Z'), player_name: 'Third WR', owner_id: 22, email: 'b@x.test', league_name: 'Lg One' },
];
// Honours the watermark parameter, as the real query does.
const claimsHandler = (rows) => [/FROM "waiver_claims"/, (text, [, since]) => ({ rows: rows.filter((r) => r.processed_at > since) })];
const waiver = () => sendAlert({ kind: 'waiver-results', leagueId: 42 });

test('waiver-results: one push per owner with the digest lines, gated by waiverResults, ledgered by league and newest claim', async (t) => {
  const state = world(t, { handlers: [claimsHandler(CLAIMS)], prefs: { 22: off('waiverResults') } });

  const result = await waiver();

  assert.deepEqual(state.sent, [{
    userIds: [11],
    payload: { title: 'Waiver results: Lg One', body: 'WON: Sleeper WR ($12) · LOST: Other WR · outbid', url: '/#/league/42/waivers' },
  }]);
  assert.deepEqual(state.inserts(), [[11, 'waiver-results', '42', '2026-10-11T17:31:00.000Z']]);
  assert.equal(result.fresh.length, 1);
  assert.deepEqual([result.fresh[0].email, result.fresh[0].leagueName, result.fresh[0].lines],
    ['a@x.test', 'Lg One', ['WON: Sleeper WR ($12)', 'LOST: Other WR · outbid']]);
  assert.deepEqual([result.sent, result.skipped], [1, 1]);
});

test('waiver-results: with no ledger row the window is the last hour; with one it is the newest digested claim', async (t) => {
  const state = world(t, { handlers: [claimsHandler(CLAIMS)] });

  await waiver();
  assert.deepEqual(state.fake.matching(/FROM "waiver_claims"/)[0].params, [42, new Date('2026-10-11T17:00:00Z')]);

  await waiver();
  assert.deepEqual(state.fake.matching(/FROM "waiver_claims"/)[1].params, [42, new Date('2026-10-11T17:31:00.000Z')]);
});

test('waiver-results: a restart does not repeat the digest, and a later claim is digested alone', async (t) => {
  const first = world(t, { handlers: [claimsHandler(CLAIMS)] });
  await waiver();
  assert.equal(first.sent.length, 2);

  const second = world(t, { handlers: [claimsHandler(CLAIMS)], ledger: first.ledger });
  const again = await waiver();
  assert.deepEqual([second.sent, again.fresh], [[], []]);

  const later = { ...CLAIMS[2], processed_at: new Date('2026-10-11T17:45:00.000Z'), player_name: 'Late WR' };
  const third = world(t, { handlers: [claimsHandler([...CLAIMS, later])], ledger: first.ledger });
  await waiver();
  assert.deepEqual(third.sent.map((s) => [s.userIds[0], s.payload.body]), [[22, 'LOST: Late WR ($3)']]);
});

// ------------------------------------------------------------ draft alerts

const LEAGUE = { id: 4, name: 'Gridiron', draft_date: '2026-10-20T00:00:00.000Z' };
const DRAFT_HANDLERS = [[select('teams'), () => ({ rows: [{ owner_id: 11 }, { owner_id: 22 }] })]];
const reminder = (action = 'remind_24h', league = LEAGUE) => sendAlert({ kind: 'draft-reminder', league, action });

test('draft-reminder: every owner of the league, gated by draftReminders, ledgered by league and action:draft date', async (t) => {
  const state = world(t, { handlers: DRAFT_HANDLERS, prefs: { 22: off('draftReminders') } });

  await reminder('remind_24h');
  await reminder('remind_1h');

  assert.deepEqual(state.sent.map((s) => [s.userIds, s.payload]), [
    [[11], { title: 'Draft reminder', body: "Gridiron's draft starts in about 24 hours.", url: '/#/league/4/draft' }],
    [[11], { title: 'Draft reminder', body: "Gridiron's draft starts in about an hour.", url: '/#/league/4/draft' }],
  ]);
  assert.deepEqual(state.inserts(), [
    [11, 'draft-reminder', '4', 'remind_24h:2026-10-20T00:00:00.000Z'],
    [11, 'draft-reminder', '4', 'remind_1h:2026-10-20T00:00:00.000Z'],
  ]);
});

test('draft-reminder: a repeat sends once, a restart sends nothing, a rescheduled draft reminds again', async (t) => {
  const first = world(t, { handlers: DRAFT_HANDLERS });
  await reminder();
  await reminder();
  assert.equal(first.sent.length, 2);

  const second = world(t, { handlers: DRAFT_HANDLERS, ledger: first.ledger });
  await reminder();
  assert.deepEqual(second.sent, []);

  await reminder('remind_24h', { ...LEAGUE, draft_date: '2026-10-21T00:00:00.000Z' });
  assert.equal(second.sent.length, 2);
});

test('draft-starting: every owner, gated by draftReminders, ledgered by league and "start", with the draftStarting Banter', async (t) => {
  const state = world(t, { handlers: DRAFT_HANDLERS, prefs: { 22: off('draftReminders') } });

  await sendAlert({ kind: 'draft-starting', league: LEAGUE });
  await sendAlert({ kind: 'draft-starting', league: LEAGUE });

  assert.deepEqual(state.sent, [{
    userIds: [11],
    payload: {
      title: 'Draft starting now',
      body: "Gridiron's draft is live. Join the room.",
      url: '/#/league/4/draft',
      banter: banterFor('draftStarting', 'draft:4', { league: 'Gridiron' }),
    },
  }]);
  assert.deepEqual(state.inserts(), [[11, 'draft-starting', '4', 'start']]);
});

// ------------------------------------------------------------- trade-offer

test('trade-offer: the other team\'s owner, gated by tradeOffers, no ledger (a counter is a new offer)', async (t) => {
  const state = world(t);
  const offer = () => sendAlert({ kind: 'trade-offer', otherTeamOwnerId: 22, myTeamName: 'Home FC', leagueId: 42 });

  await offer();
  await offer();

  assert.deepEqual(state.sent[0], {
    userIds: [22],
    payload: { title: 'New trade offer', body: 'Home FC sent you a trade offer', url: '/#/league/42/trades' },
  });
  assert.equal(state.sent.length, 2);
  assert.equal(state.fake.matching(insert('push_events')).length, 0);

  const gated = world(t, { prefs: { 22: off('tradeOffers') } });
  assert.deepEqual(await offer(), { sent: 0, skipped: 1, fresh: [] });
  assert.deepEqual(gated.sent, []);
});

// -------------------------------------------------------------------- test

test('test: sends one Test alert to the caller with a filled Banter line from a real situation, no preference gate, no ledger', async (t) => {
  const state = world(t, { prefs: { 7: { banter: false, scoreUpdates: false } } });

  const result = await sendAlert({ kind: 'test', userId: 7, now: 1700000000003 });

  assert.equal(state.sent.length, 1);
  const { userIds, payload } = state.sent[0];
  assert.deepEqual(userIds, [7]);
  assert.equal(payload.title, 'Test alert');
  assert.equal(payload.body, 'Sent from your Notification Settings. A real alert puts its facts here.');
  assert.equal(payload.url, '/#/settings/notifications');
  assert.equal(typeof payload.banter, 'string');
  assert.ok(payload.banter.length > 0);
  assert.doesNotMatch(payload.banter, /\{/, 'every placeholder is filled from the sample facts');
  assert.ok(SITUATIONS.length > 0);
  assert.equal(result.sent, 1);
  assert.equal(state.fake.calls.length, 0, 'no prefs read and no ledger write');
});

test('test: rotates the situation with the send time and reports sent: 0 when no device is subscribed', async (t) => {
  const state = world(t);
  push.sendPushToUsers.mock.mockImplementation(async (userIds, payload) => { state.sent.push({ userIds, payload }); return { sent: 0 }; });

  const a = await sendAlert({ kind: 'test', userId: 7, now: 1700000000000 });
  await sendAlert({ kind: 'test', userId: 7, now: 1700000000001 });

  assert.notEqual(state.sent[0].payload.banter, state.sent[1].payload.banter);
  assert.equal(state.sent[0].payload.banter, banterFor(SITUATIONS[1700000000000 % SITUATIONS.length], 'push-test:7:1700000000000', {
    mine: 'Your Squad', theirs: 'The Other Guys', player: 'Sample Player', event: 'rushing touchdown', points: 6.5, count: 3, margin: 2.5, week: 1, league: 'Your League',
  }));
  assert.equal(a.sent, 0);
});

// ------------------------------------------------- the ledger (sendPushOnce)

test('ledger: once per (user, kind, subject, fingerprint); a new fingerprint sends again; pref off writes no row and sends nothing', async (t) => {
  const state = world(t, { prefs: { 2: off('lineupReminder') } });

  assert.deepEqual((await lineup({ team: { id: 7, owner_id: 1 } })).sent, 1);
  assert.deepEqual((await lineup({ team: { id: 7, owner_id: 1 } })).sent, 0);
  assert.deepEqual(to(state), [1]);

  await lineup({ team: { id: 7, owner_id: 1 }, week: 10 });
  assert.deepEqual(to(state), [1, 1], 'a new subject sends again');

  const gated = await lineup({ team: { id: 8, owner_id: 2 } });
  assert.deepEqual([gated.sent, gated.skipped], [0, 1]);
  assert.deepEqual(to(state), [1, 1]);
  assert.deepEqual(state.inserts().map((p) => p[0]), [1, 1], 'no row for the user with the pref off');
});

test('ledger: a delivery failure is logged, not thrown, and the row stays so the alert is not retried', async (t) => {
  const state = world(t);
  t.mock.method(console, 'error', () => {});
  push.sendPushToUsers.mock.mockImplementation(async () => { throw new Error('subscriptions down'); });

  const result = await lineup();
  const again = await lineup();

  assert.deepEqual([result.sent, result.skipped, result.fresh.length], [0, 0, 1]);
  assert.deepEqual([again.sent, again.skipped], [0, 1]);
  assert.equal(state.ledger.length, 1);
  assert.equal(console.error.mock.calls[0].arguments[0], 'push alert %s failed:');
  assert.equal(console.error.mock.calls[0].arguments[1], 'lineup-reminder');
  assert.equal(console.error.mock.calls[0].arguments[2], 'subscriptions down');
});

test('ledger: a ledger error fails closed: nobody is sent and nobody is fresh', async (t) => {
  const state = world(t, { handlers: [[insert('push_events'), () => { throw new Error('ledger down'); }]] });
  t.mock.method(console, 'error', () => {});

  const result = await lineup();

  assert.deepEqual([result.sent, result.fresh], [0, []]);
  assert.deepEqual(state.sent, []);
});

test('an unknown kind throws synchronously; a failing row logs and returns what it managed', async (t) => {
  world(t, { handlers: [[select('teams'), () => { throw new Error('db down'); }]] });
  t.mock.method(console, 'error', () => {});

  assert.throws(() => sendAlert({ kind: 'nope' }), /unknown push alert kind: nope/);
  assert.throws(() => sendAlert({ kind: 'constructor' }), /unknown push alert kind/);
  assert.deepEqual(await sendAlert({ kind: 'draft-starting', league: LEAGUE }), { sent: 0, skipped: 0, fresh: [] });
});
