const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./fixtures/espn-scoreboard-2025-w1.json');
const {
  normalizeEspnEvent,
  normalizeEspnScoreboard,
  resolveGameIds,
  mapEspnStatus,
  mapEspnQuarter,
  espnAbbrToOurs,
  etDateKey,
  fetchLiveRows,
} = require('../modules/espnScoreboard');

// --- team codes --------------------------------------------------------------

test('espnAbbrToOurs: Washington stays WSH, the code Tank01 game ids use', () => {
  // fn_normalize_nfl_team folds WSH -> WAS for joins, but a gameID is spelled
  // WSH; normalizing to WAS here would build an id nothing can match.
  assert.equal(espnAbbrToOurs('WSH'), 'WSH');
  assert.equal(espnAbbrToOurs('WAS'), 'WSH');
});

test('espnAbbrToOurs: legacy/relocation codes map forward', () => {
  assert.equal(espnAbbrToOurs('LA'), 'LAR');
  assert.equal(espnAbbrToOurs('STL'), 'LAR');
  assert.equal(espnAbbrToOurs('SD'), 'LAC');
  assert.equal(espnAbbrToOurs('OAK'), 'LV');
  assert.equal(espnAbbrToOurs('JAC'), 'JAX');
});

test('espnAbbrToOurs: matching codes pass through, junk is rejected', () => {
  assert.equal(espnAbbrToOurs('kc'), 'KC');
  assert.equal(espnAbbrToOurs('PHI'), 'PHI');
  assert.equal(espnAbbrToOurs(''), null);
  assert.equal(espnAbbrToOurs(null), null);
  assert.equal(espnAbbrToOurs('CHIEFS'), null);
});

test('espnAbbrToOurs: TBD (flex-scheduled placeholder) is not a team', () => {
  // Shaped like a real code, so only membership in the 32 rejects it.
  assert.equal(espnAbbrToOurs('TBD'), null);
});

test('every ESPN code in a real week normalizes to one of our 32 codes', () => {
  const ours = new Set([
    'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN', 'DET', 'GB',
    'HOU', 'IND', 'JAX', 'KC', 'LV', 'LAC', 'LAR', 'MIA', 'MIN', 'NE', 'NO', 'NYG',
    'NYJ', 'PHI', 'PIT', 'SF', 'SEA', 'TB', 'TEN', 'WSH',
  ]);
  for (const event of fixture.events) {
    for (const c of event.competitions[0].competitors) {
      const mapped = espnAbbrToOurs(c.team.abbreviation);
      assert.ok(ours.has(mapped), `${c.team.abbreviation} -> ${mapped}`);
    }
  }
});

// --- ET dating (the tank01GameId trick) --------------------------------------

test('etDateKey: a UTC-next-day night kickoff is dated the ET day it kicked off', () => {
  // 2025-09-05T00:20Z is Thursday 8:20pm ET on 2025-09-04.
  assert.equal(etDateKey('2025-09-05T00:20Z'), '20250904');
});

test('etDateKey: an afternoon kickoff keeps its own date', () => {
  assert.equal(etDateKey('2025-09-07T17:00Z'), '20250907');
});

test('etDateKey: works across the DST boundary (January night game)', () => {
  assert.equal(etDateKey('2026-01-12T01:15Z'), '20260111'); // 8:15pm EST Jan 11
});

test('etDateKey: unusable input -> null', () => {
  assert.equal(etDateKey('not a date'), null);
  assert.equal(etDateKey(null), null);
});

// --- status / quarter mapping ------------------------------------------------

test('mapEspnStatus: pre/in/post map to our enum', () => {
  assert.equal(mapEspnStatus({ type: { state: 'pre' } }), 'scheduled');
  assert.equal(mapEspnStatus({ type: { state: 'in' } }), 'in_progress');
  assert.equal(mapEspnStatus({ type: { state: 'post' } }), 'final');
});

test('mapEspnStatus: an unknown state errs toward polling more', () => {
  assert.equal(mapEspnStatus({ type: { state: 'weird' } }), 'in_progress');
  assert.equal(mapEspnStatus({}), 'in_progress');
  assert.equal(mapEspnStatus({ type: { state: 'weird', completed: true } }), 'final');
});

test('mapEspnQuarter: periods, overtime, halftime, final', () => {
  assert.equal(mapEspnQuarter({ period: 3, type: { name: 'STATUS_IN_PROGRESS' } }, 'in_progress'), 'Q3');
  assert.equal(mapEspnQuarter({ period: 5, type: {} }, 'in_progress'), 'OT');
  assert.equal(mapEspnQuarter({ period: 6, type: {} }, 'in_progress'), 'OT2');
  assert.equal(mapEspnQuarter({ period: 2, type: { name: 'STATUS_HALFTIME' } }, 'in_progress'), 'Half');
  assert.equal(mapEspnQuarter({ period: 4, type: { name: 'STATUS_FINAL' } }, 'final'), 'Final');
  assert.equal(mapEspnQuarter({ period: 0, type: {} }, 'scheduled'), null);
});

// --- event normalization ----------------------------------------------------

test('normalizeEspnEvent: a real final event maps to our row shape', () => {
  const event = fixture.events.find((e) => e.shortName === 'DAL @ PHI');
  const row = normalizeEspnEvent(event, { season: 2025, week: 1 });
  assert.deepEqual(
    { ...row, startTime: row.startTime.toISOString() },
    {
      tank01GameId: '20250904_DAL@PHI', // matches Tank01's own id for this game
      season: 2025,
      week: 1,
      homeTeam: 'PHI',
      awayTeam: 'DAL',
      gameStatus: 'final',
      startTime: '2025-09-05T00:20:00.000Z',
      currentScoreHome: 24,
      currentScoreAway: 20,
      quarter: 'Final',
      timeRemaining: null, // '0:00' is noise once a game is over
    }
  );
});

test('normalizeEspnEvent: an in-progress event carries the clock through', () => {
  const row = normalizeEspnEvent(
    {
      date: '2026-09-13T17:00Z',
      competitions: [
        {
          date: '2026-09-13T17:00Z',
          status: { displayClock: '8:42', period: 3, type: { state: 'in', name: 'STATUS_IN_PROGRESS' } },
          competitors: [
            { homeAway: 'home', score: '10', team: { abbreviation: 'NYJ' } },
            { homeAway: 'away', score: '14', team: { abbreviation: 'BUF' } },
          ],
        },
      ],
    },
    { season: 2026, week: 2 }
  );
  assert.equal(row.gameStatus, 'in_progress');
  assert.equal(row.quarter, 'Q3');
  assert.equal(row.timeRemaining, '8:42');
  assert.equal(row.tank01GameId, '20260913_BUF@NYJ');
});

test('normalizeEspnEvent: a Washington game keeps WSH in the id', () => {
  const row = normalizeEspnEvent(
    {
      competitions: [
        {
          date: '2026-09-13T17:00Z',
          status: { type: { state: 'pre' } },
          competitors: [
            { homeAway: 'home', score: '0', team: { abbreviation: 'WSH' } },
            { homeAway: 'away', score: '0', team: { abbreviation: 'NYG' } },
          ],
        },
      ],
    },
    { season: 2026, week: 2 }
  );
  assert.equal(row.tank01GameId, '20260913_NYG@WSH');
  assert.equal(row.homeTeam, 'WSH');
});

test('normalizeEspnEvent: events missing anything load-bearing -> null', () => {
  const base = {
    competitions: [
      {
        date: '2026-09-13T17:00Z',
        status: { type: { state: 'pre' } },
        competitors: [
          { homeAway: 'home', score: '0', team: { abbreviation: 'KC' } },
          { homeAway: 'away', score: '0', team: { abbreviation: 'DEN' } },
        ],
      },
    ],
  };
  const at = { season: 2026, week: 1 };
  assert.equal(normalizeEspnEvent(null, at), null);
  assert.equal(normalizeEspnEvent({}, at), null);
  assert.equal(normalizeEspnEvent({ competitions: [] }, at), null);
  // one side missing
  assert.equal(
    normalizeEspnEvent(
      { competitions: [{ ...base.competitions[0], competitors: [base.competitions[0].competitors[0]] }] },
      at
    ),
    null
  );
  // unmappable team code
  assert.equal(
    normalizeEspnEvent(
      {
        competitions: [
          {
            ...base.competitions[0],
            competitors: [
              { homeAway: 'home', score: '0', team: { abbreviation: 'TBD' } },
              base.competitions[0].competitors[1],
            ],
          },
        ],
      },
      at
    ),
    null
  );
  // no usable kickoff
  assert.equal(
    normalizeEspnEvent({ competitions: [{ ...base.competitions[0], date: 'nope' }] }, at),
    null
  );
});

// --- whole-payload normalization --------------------------------------------

test('normalizeEspnScoreboard: a real 16-game week normalizes completely', () => {
  const { rows, dropped } = normalizeEspnScoreboard(fixture, { season: 2025, week: 1 });
  assert.equal(rows.length, 16);
  assert.deepEqual(dropped, []);
  for (const row of rows) {
    assert.match(row.tank01GameId, /^\d{8}_[A-Z]{2,3}@[A-Z]{2,3}$/);
    assert.equal(row.season, 2025);
    assert.equal(row.week, 1);
    assert.ok(['scheduled', 'in_progress', 'final'].includes(row.gameStatus));
  }
  assert.equal(new Set(rows.map((r) => r.tank01GameId)).size, 16, 'ids are unique');
});

test('normalizeEspnScoreboard: the Friday Brazil game is dated in ET, not UTC', () => {
  const { rows } = normalizeEspnScoreboard(fixture, { season: 2025, week: 1 });
  const brazil = rows.find((r) => r.awayTeam === 'KC' && r.homeTeam === 'LAC');
  assert.ok(brazil, 'KC@LAC present');
  assert.equal(brazil.tank01GameId, '20250905_KC@LAC');
});

test('normalizeEspnScoreboard: a bad event is dropped and reported, the rest survive', () => {
  const payload = {
    events: [
      fixture.events[0],
      { id: '999', shortName: 'TBD @ TBD', competitions: [{ competitors: [] }] },
      fixture.events[1],
    ],
  };
  const { rows, dropped } = normalizeEspnScoreboard(payload, { season: 2025, week: 1 });
  assert.equal(rows.length, 2);
  assert.deepEqual(dropped, ['TBD @ TBD']);
});

test('normalizeEspnScoreboard: a missing/empty payload is not an error', () => {
  assert.deepEqual(normalizeEspnScoreboard(null, { season: 2025, week: 1 }), { rows: [], dropped: [] });
  assert.deepEqual(normalizeEspnScoreboard({}, { season: 2025, week: 1 }), { rows: [], dropped: [] });
});

// --- game id resolution against nfl_games ------------------------------------

test('resolveGameIds: our own stored kickoff date wins over ESPN’s', () => {
  const rows = [
    { tank01GameId: '20260914_DEN@KC', homeTeam: 'KC', awayTeam: 'DEN' },
    { tank01GameId: '20260913_NYG@WSH', homeTeam: 'WSH', awayTeam: 'NYG' },
  ];
  const kickoffByPair = new Map([
    // Tank01 dated this one a day earlier than ESPN did.
    ['DEN|KC', new Date('2026-09-14T00:15:00Z')], // 8:15pm ET on the 13th
    ['NYG|WSH', new Date('2026-09-13T17:00:00Z')],
  ]);
  const { rows: out, unmatched } = resolveGameIds(rows, kickoffByPair);
  assert.equal(out[0].tank01GameId, '20260913_DEN@KC');
  assert.equal(out[1].tank01GameId, '20260913_NYG@WSH'); // unchanged
  assert.deepEqual(unmatched, []);
});

test('resolveGameIds: a game absent from nfl_games keeps its ESPN id and is reported', () => {
  const rows = [{ tank01GameId: '20260914_DEN@KC', homeTeam: 'KC', awayTeam: 'DEN' }];
  const { rows: out, unmatched } = resolveGameIds(rows, new Map());
  assert.equal(out[0].tank01GameId, '20260914_DEN@KC');
  assert.deepEqual(unmatched, ['20260914_DEN@KC']);
});

// --- fetch (injected transport; no network) -----------------------------------

test('fetchLiveRows: hits the free scoreboard endpoint with (week, seasontype, dates)', async () => {
  const seen = [];
  const transport = {
    async get(url, opts) {
      seen.push({ url, params: opts.params });
      return { data: fixture };
    },
  };
  const { rows } = await fetchLiveRows({
    season: 2025,
    week: 1,
    transport,
    kickoffByPair: new Map(), // skip the DB read
  });
  assert.equal(seen.length, 1);
  assert.match(seen[0].url, /site\.api\.espn\.com/);
  assert.deepEqual(seen[0].params, { week: 1, seasontype: 2, dates: 2025 });
  assert.equal(rows.length, 16);
});
