const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool } = require('./helpers/fakePool');
const lineup = require('../services/lineup.service');
const expectedFinal = require('../services/expectedFinal.service');
const {
  writePreviews, writePostgames, templatePreview, templatePostgame,
} = require('../services/matchupNarrative.service');

/**
 * Matchup narrative (ADR 0063): templates, the template-first write, the
 * once-only preview, the overwriting postgame, the number check on a rewrite
 * and the parallel rewrites. A small world of rows behind the fake pool;
 * league_analytics is stateful and merges one (matchup, moment) key per
 * upsert, as the real SQL does.
 */

const NOW = new Date('2026-10-08T14:00:00.000Z');
const LEAGUE = { id: 71, current_season: 2026, current_week: 5 };
const NAMES = { 10: "Cory's Crunchers", 20: 'Ham Lake Hitmen', 30: 'Third Wheels', 40: 'Gridiron Geeks' };
const stripTokens = (s) => s.replace(/\[\[team:\d+\]\]/g, '');

const player = (id, name, nfl_team) => ({ id, name, nfl_team });
const starter = (playerId, position, projection, extra = {}) => ({ playerId, position, projection, ...extra });
const open = (id, home, away) => ({ id, league_id: 71, season: 2026, week: 5, home_team_id: home, away_team_id: away, final: false });

function world(extra = {}) {
  const w = {
    kickoff: '2026-10-09T00:20:00.000Z',
    matchups: [open(901, 10, 20)],
    stored: null, // the matchup_narratives data
    writes: [], // every upsert: { matchupId, moment, source }, in order
    failClaudePutFor: null, // matchup id whose claude write throws
    lineupRows: {}, // team id -> lineup_entries rows
    usage: 0,
    ...extra,
  };
  w.fake = createFakePool([
    [/FROM "nfl_games"/, () => ({ rows: [{ first: w.kickoff }] })],
    [/FROM "league_analytics"/, () => ({ rows: w.stored ? [{ data: w.stored }] : [] })],
    [/^INSERT INTO "league_analytics"/, async (text, params) => {
      const [, , , matchupId, moment, value] = params;
      const entry = JSON.parse(value);
      if (entry.source === 'claude' && Number(matchupId) === w.failClaudePutFor) throw new Error('write boom');
      await new Promise((resolve) => setImmediate(resolve)); // let parallel puts interleave
      w.stored = w.stored || { matchups: {} };
      w.stored.matchups[matchupId] = { ...w.stored.matchups[matchupId], [moment]: entry };
      w.writes.push({ matchupId: Number(matchupId), moment, source: entry.source });
      return { rows: [], rowCount: 1 };
    }],
    [/FROM "matchups"/, () => ({ rows: w.matchups })],
    [/FROM "teams"/, () => ({ rows: Object.entries(NAMES).map(([id, name]) => ({ id: Number(id), name })) })],
    [/FROM "players"/, () => ({ rows: [player(1, 'Josh Allen', 'BUF'), player(2, 'Bijan Robinson', 'ATL'), player(3, 'Zero Guy', 'KC')] })],
    [/FROM "leagues"/, () => ({ rows: [{ id: 71 }] })],
    [/FROM "lineup_entries"/, (text, params) => ({ rows: w.lineupRows[params[0]] || [] })],
    [/FROM "llm_usage"/, () => ({ rows: [{ spent: w.usage }] })],
    [/^INSERT INTO "llm_usage"/, () => ({ rows: [], rowCount: 1 })],
  ]);
  return w;
}

// A Claude stub that records the request and what was stored when it was asked.
// `text` may be a function of the call index.
function stubClient(w, text) {
  const client = {
    requests: [],
    storedAtCall: [],
    messages: {
      create: async (req) => {
        const i = client.requests.length;
        client.requests.push(req);
        client.storedAtCall.push(structuredClone(w.stored));
        const out = typeof text === 'function' ? await text(i) : text;
        return { stop_reason: 'end_turn', content: [{ type: 'text', text: out }], usage: {} };
      },
    },
  };
  return client;
}

function stubEngine(t, { home = 110, away = 100, homeStarters, awayStarters } = {}) {
  t.mock.method(lineup, 'materializeLineup', async () => {});
  t.mock.method(expectedFinal, 'expectedFinalsForWeek', async ({ teamIds }) => new Map([
    [teamIds[0], { expectedFinal: home, starters: homeStarters || [starter(1, 'QB', 24)] }],
    [teamIds[1], { expectedFinal: away, starters: awayStarters || [starter(2, 'RB', 18)] }],
  ]));
}

const preview = (w, client) => writePreviews({ league: LEAGUE, now: NOW, db: w.fake, client });
const postgame = (w, client) =>
  writePostgames({ leagueId: 71, season: 2026, week: 5, now: NOW, db: w.fake, client });

const facts = (over = {}) => ({
  home: { token: '[[team:10]]', starters: [{ name: 'Josh Allen', position: 'QB', nflTeam: 'BUF' }] },
  away: { token: '[[team:20]]', starters: [{ name: 'Bijan Robinson', position: 'RB', nflTeam: 'ATL' }] },
  favoured: 'home',
  edge: 'slim',
  ...over,
});

const finalFacts = (over = {}) => ({
  home: { token: '[[team:10]]', score: 114.5, topScorer: { name: 'Josh Allen', position: 'QB', points: 31.2 }, record: '4-1' },
  away: { token: '[[team:20]]', score: 98.2, topScorer: { name: 'Bijan Robinson', position: 'RB', points: 22 }, record: '2-3' },
  winner: '[[team:10]]',
  closest: false,
  ...over,
});

// ---- templates ---------------------------------------------------------------

test('the preview template names Teams by token only, says "this week" and states no number', () => {
  const text = templatePreview(facts());
  assert.match(text, /\[\[team:10\]\] and \[\[team:20\]\] meet this week\./);
  assert.match(text, /\[\[team:10\]\] holds a slim projected edge\./);
  assert.match(text, /Josh Allen/);
  assert.doesNotMatch(stripTokens(text), /\d/);
  assert.doesNotMatch(text, /—/);
  for (const name of Object.values(NAMES)) assert.equal(text.includes(name), false);
});

test('the preview template reads its edge word: even, slim, clear', () => {
  assert.match(templatePreview(facts({ favoured: 'even', edge: 'even' })), /neck and neck/);
  assert.match(templatePreview(facts({ favoured: 'away', edge: 'clear' })), /\[\[team:20\]\] holds a clear projected edge\./);
});

test('the postgame template carries the score and tokens, never a Team name', () => {
  const text = templatePostgame(finalFacts({ closest: true }));
  assert.match(text, /\[\[team:10\]\] beat \[\[team:20\]\] 114\.5 to 98\.2 this week, the closest finish of the week\./);
  assert.match(text, /Josh Allen led \[\[team:10\]\] with 31\.2 points/);
  assert.match(text, /\[\[team:10\]\] is now 4-1/);
  assert.doesNotMatch(text, /—/);
  for (const name of Object.values(NAMES)) assert.equal(text.includes(name), false);
  assert.match(templatePostgame(finalFacts({ winner: 'tie' })), /tied 114\.5 to 98\.2 this week/);
});

test('the postgame template skips a top scorer with no points', () => {
  const f = finalFacts();
  f.home.topScorer.points = 0;
  f.away.topScorer.points = 0;
  assert.doesNotMatch(templatePostgame(f), /led/);
});

// ---- previews ----------------------------------------------------------------

test('a preview stores the template (names back in) before Claude is asked, then the rewrite', async (t) => {
  stubEngine(t);
  const w = world();
  const client = stubClient(w, 'A rewrite by Claude.');
  await preview(w, client);

  assert.equal(client.requests.length, 1);
  const atCall = client.storedAtCall[0].matchups[901].preview;
  assert.equal(atCall.source, 'template');
  assert.match(atCall.narrative, /Cory's Crunchers and Ham Lake Hitmen meet this week\./);
  assert.deepEqual(w.writes.map((x) => x.source), ['template', 'claude']);
  const final = w.stored.matchups[901].preview;
  assert.equal(final.source, 'claude');
  assert.equal(final.narrative, 'A rewrite by Claude.');
  assert.ok(final.generatedAt);
});

test('the preview prompt carries tokens and not one digit or Team name', async (t) => {
  stubEngine(t);
  const w = world();
  const client = stubClient(w, 'x');
  await preview(w, client);

  const { system, messages } = client.requests[0];
  const user = messages[0].content;
  assert.match(user, /\[\[team:10\]\]/);
  assert.match(user, /Josh Allen/);
  assert.match(user, /"edge": "slim"/);
  // The only digits are inside the Team tokens.
  assert.doesNotMatch(stripTokens(user), /\d/);
  for (const name of Object.values(NAMES)) {
    assert.equal(user.includes(name), false);
    assert.equal(system.includes(name), false);
  }
  assert.match(system, /Use ONLY the facts provided/);
});

test('a preview rewrite that states a number is discarded for the template', async (t) => {
  stubEngine(t);
  const w = world();
  await preview(w, stubClient(w, 'Cory\'s Crunchers win by 10.'));
  assert.equal(w.stored.matchups[901].preview.source, 'template');
  // A Team name with a digit in it is not a number of the text's own.
  const t2 = world();
  NAMES[10] = 'Team 7';
  try {
    await preview(t2, stubClient(t2, 'Team 7 holds the edge over Ham Lake Hitmen.'));
  } finally {
    NAMES[10] = "Cory's Crunchers";
  }
  assert.equal(t2.stored.matchups[901].preview.source, 'claude');
});

test('a preview keeps the template when Claude is unavailable', async (t) => {
  stubEngine(t);
  const w = world();
  await preview(w, { messages: { create: async () => { throw new Error('down'); } } });
  assert.equal(w.stored.matchups[901].preview.source, 'template');
});

test('a preview is written once: a second call asks no one and writes nothing', async (t) => {
  stubEngine(t);
  const w = world();
  const client = stubClient(w, 'First.');
  await preview(w, client);
  const writes = w.writes.length;
  await preview(w, client);
  assert.equal(client.requests.length, 1);
  assert.equal(w.writes.length, writes);
});

test('no preview once the first Kickoff has passed, or before a projection exists', async (t) => {
  stubEngine(t);
  const started = world({ kickoff: '2026-10-08T13:00:00.000Z' });
  await preview(started, stubClient(started, 'x'));
  assert.equal(started.writes.length, 0);

  t.mock.method(expectedFinal, 'expectedFinalsForWeek', async () => new Map([
    [10, { expectedFinal: null, starters: [] }], [20, { expectedFinal: null, starters: [] }],
  ]));
  const unprojected = world();
  await preview(unprojected, stubClient(unprojected, 'x'));
  assert.equal(unprojected.writes.length, 0);
});

test('the headliner is an available starter projected to score', async (t) => {
  stubEngine(t, {
    homeStarters: [
      starter(3, 'WR', 0), starter(2, 'RB', 30, { availability: { available: false } }), starter(1, 'QB', 12),
    ],
  });
  const w = world();
  const client = stubClient(w, 'x');
  await preview(w, client);
  assert.match(client.storedAtCall[0].matchups[901].preview.narrative, /leans on Josh Allen/);
  const sent = JSON.parse(client.requests[0].messages[0].content.split('from these facts:')[1]);
  assert.deepEqual(sent.home.starters.map((x) => x.name), ['Josh Allen']);
});

test('one failing Matchup logs and the next still gets its preview', async (t) => {
  let calls = 0;
  t.mock.method(lineup, 'materializeLineup', async () => { if (++calls === 1) throw new Error('boom'); });
  t.mock.method(expectedFinal, 'expectedFinalsForWeek', async (args) => new Map(args.teamIds.map((id) => [
    id, { expectedFinal: 100, starters: [starter(1, 'QB', 20)] },
  ])));
  const w = world({ matchups: [open(901, 10, 20), open(902, 30, 40)] });
  await preview(w, stubClient(w, 'Second.'));
  assert.equal(w.stored.matchups[901], undefined);
  assert.equal(w.stored.matchups[902].preview.narrative, 'Second.');
});

test('every template is stored before the first model call; interleaved rewrites keep both Matchups', async (t) => {
  stubEngine(t);
  const w = world({ matchups: [open(901, 10, 20), open(902, 30, 40)] });
  // The first rewrite answers last, so the two puts land out of order.
  const client = stubClient(w, async (i) => {
    await new Promise((resolve) => setTimeout(resolve, i === 0 ? 20 : 1));
    return `Rewrite ${i === 0 ? 'one' : 'two'}.`;
  });
  await preview(w, client);

  assert.equal(client.requests.length, 2);
  for (const seen of client.storedAtCall) {
    assert.equal(seen.matchups[901].preview.source, 'template');
    assert.equal(seen.matchups[902].preview.source, 'template');
  }
  assert.equal(w.stored.matchups[901].preview.narrative, 'Rewrite one.');
  assert.equal(w.stored.matchups[902].preview.narrative, 'Rewrite two.');
});

test('a rewrite whose write rejects does not stop the other Matchups', async (t) => {
  stubEngine(t);
  const w = world({ matchups: [open(901, 10, 20), open(902, 30, 40)], failClaudePutFor: 901 });
  await preview(w, stubClient(w, 'Rewritten.'));
  assert.equal(w.stored.matchups[901].preview.source, 'template');
  assert.equal(w.stored.matchups[902].preview.source, 'claude');
});

// ---- postgames ---------------------------------------------------------------

const finalMatchup = (extra = {}) => ({
  id: 901, league_id: 71, season: 2026, week: 5, home_team_id: 10, away_team_id: 20,
  home_score: '114.50', away_score: '98.20', final: true, is_playoff: false, ...extra,
});

// Home's best starter scored 31.2 (312 rushing yards at 0.1), away's 5.0.
const lineupRow = (id, name, slot, stats) => ({
  player_id: id, name, slot, position: 'RB', nfl_team: 'BUF', stats,
});
const lineups = () => ({
  10: [lineupRow(1, 'Josh Allen', 'RB1', { rushingYards: 312 }), lineupRow(4, 'Bench Guy', 'BENCH', { rushingYards: 900 })],
  20: [lineupRow(2, 'Bijan Robinson', 'RB1', { rushingYards: 50 })],
});

function postgameWorld(extra = {}) {
  return world({ matchups: [finalMatchup()], lineupRows: lineups(), ...extra });
}

function stubHeld(t) {
  t.mock.method(lineup, 'rowsHeldAsPlayed', async (db, { rows }) => rows);
}

test('a postgame overwrites the stored one and leaves the preview alone', async (t) => {
  stubHeld(t);
  const w = postgameWorld({
    stored: { matchups: { 901: { preview: { narrative: 'Before.', source: 'template' }, postgame: { narrative: 'Old.', source: 'claude' } } } },
  });
  const client = stubClient(w, 'Cory\'s Crunchers won it, 114.5 to 98.2.');
  await postgame(w, client);

  const m = w.stored.matchups[901];
  assert.equal(m.preview.narrative, 'Before.');
  assert.equal(m.postgame.source, 'claude');
  assert.equal(m.postgame.narrative, "Cory's Crunchers won it, 114.5 to 98.2.");
  const template = client.storedAtCall[0].matchups[901].postgame;
  assert.equal(template.source, 'template');
  assert.match(template.narrative, /Cory's Crunchers beat Ham Lake Hitmen 114\.5 to 98\.2 this week/);
  assert.match(template.narrative, /Josh Allen led Cory's Crunchers with \d+(\.\d+)? points/);
  assert.match(template.narrative, /Cory's Crunchers is now 1-0 and Ham Lake Hitmen is 0-1\./);
});

test('the postgame prompt carries tokens, scores and top scorers, no Team name and no record', async (t) => {
  stubHeld(t);
  const w = postgameWorld({
    matchups: [finalMatchup(), finalMatchup({ id: 902, home_team_id: 30, away_team_id: 40, home_score: '100', away_score: '60' })],
  });
  const client = stubClient(w, 'x');
  await postgame(w, client);

  const user = client.requests[0].messages[0].content;
  assert.match(user, /\[\[team:10\]\]/);
  assert.match(user, /"score": 114\.5/);
  assert.match(user, /"closest": true/);
  assert.match(user, /"name": "Josh Allen"/);
  assert.doesNotMatch(user, /record|Bench Guy|1-0/);
  for (const name of Object.values(NAMES)) assert.equal(user.includes(name), false);
  assert.equal(JSON.parse(user.split('facts:\n')[1]).winner, '[[team:10]]');
});

test('a postgame rewrite stating a number the facts lack is discarded; the real score is kept', async (t) => {
  stubHeld(t);
  const wrong = postgameWorld();
  await postgame(wrong, stubClient(wrong, 'Cory\'s Crunchers won 120.5 to 98.2.'));
  assert.equal(wrong.stored.matchups[901].postgame.source, 'template');

  const record = postgameWorld();
  await postgame(record, stubClient(record, 'Cory\'s Crunchers moved to 1-0 behind a 114.5 to 98.2 win.'));
  assert.equal(record.stored.matchups[901].postgame.source, 'template');

  const right = postgameWorld();
  await postgame(right, stubClient(right, 'Cory\'s Crunchers took it 114.5 to 98.2, Josh Allen scoring 31.2 and about 31.'));
  assert.equal(right.stored.matchups[901].postgame.source, 'claude');
});

test('a week with no final Matchup writes nothing', async (t) => {
  stubHeld(t);
  const w = postgameWorld({ matchups: [finalMatchup({ final: false })] });
  await postgame(w, stubClient(w, 'x'));
  assert.equal(w.writes.length, 0);
});
