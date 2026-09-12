const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./fixtures/espn-scoreboard-2025-w1.json');
const {
  normalizeEspnEvent,
  normalizeEspnScoreboard,
  resolveGameIds,
  mapEspnStatus,
  mapEspnQuarter,
  normalizeVenue,
  normalizeBroadcast,
  normalizeRecord,
  normalizeLinescoreValues,
  normalizeHeadline,
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
      espnEventId: '401772510', // ESPN's event id, the summary endpoint's key (#1182)
      // a final game carries no Situation
      possession: null,
      downDistance: null,
      isRedZone: null,
      lastPlay: null,
      homeWinProbability: null,
      // this fixture event carries no venue/broadcast/record/linescore/headline blocks
      venueName: null,
      venueCity: null,
      isIndoor: null,
      isNeutralSite: null,
      broadcast: null,
      homeRecord: null,
      awayRecord: null,
      linescores: null,
      headline: null,
    }
  );
});

test('normalizeEspnEvent: the first event of a real week carries its ESPN event id (#1182)', () => {
  const event = fixture.events[0];
  const row = normalizeEspnEvent(event, { season: 2025, week: 1 });
  assert.equal(row.espnEventId, String(event.id));
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
  // no situation block on this payload -> all four null, same as an absent block
  assert.equal(row.possession, null);
  assert.equal(row.downDistance, null);
  assert.equal(row.isRedZone, null);
  assert.equal(row.lastPlay, null);
});

// --- Situation (#1233, ADR 0037) ---------------------------------------------

test('normalizeEspnEvent: an in-progress event with a situation block parses all four Situation fields', () => {
  const event = fixture.events.find((e) => e.shortName === 'BUF @ MIA');
  const row = normalizeEspnEvent(event, { season: 2026, week: 2 });
  assert.equal(row.gameStatus, 'in_progress');
  assert.equal(row.possession, 'BUF'); // situation.possession is a team id, not an abbreviation
  assert.equal(row.downDistance, '1st & 10');
  assert.equal(row.isRedZone, false);
  assert.equal(row.lastPlay, 'B.Allen pass complete to K.Coleman for 12 yards');
});

test('normalizeEspnEvent: possession is resolved through the competitors by team id, not abbreviation', () => {
  const row = normalizeEspnEvent(
    {
      competitions: [
        {
          date: '2026-09-13T17:00Z',
          status: { displayClock: '2:00', period: 2, type: { state: 'in' } },
          // '28' names a competitor's team.id; it is not either team's abbreviation.
          situation: { isRedZone: true, possession: '28', shortDownDistanceText: '3rd & 2' },
          competitors: [
            { homeAway: 'home', score: '10', team: { id: '15', abbreviation: 'KC' } },
            { homeAway: 'away', score: '14', team: { id: '28', abbreviation: 'DEN' } },
          ],
        },
      ],
    },
    { season: 2026, week: 2 }
  );
  assert.equal(row.possession, 'DEN');
  assert.equal(row.isRedZone, true);
});

test('normalizeEspnEvent: possession is folded through the same Team code normalisation as home/away', () => {
  const row = normalizeEspnEvent(
    {
      competitions: [
        {
          date: '2026-09-13T17:00Z',
          status: { displayClock: '2:00', period: 2, type: { state: 'in' } },
          situation: { isRedZone: false, possession: '15', shortDownDistanceText: '2nd & 5' },
          competitors: [
            { homeAway: 'home', score: '10', team: { id: '15', abbreviation: 'WAS' } },
            { homeAway: 'away', score: '14', team: { id: '28', abbreviation: 'NYG' } },
          ],
        },
      ],
    },
    { season: 2026, week: 2 }
  );
  // Same fold espnAbbrToOurs already applies to home/away: WAS -> our WSH.
  assert.equal(row.possession, 'WSH');
});

test('normalizeEspnEvent: a present situation block missing isRedZone is null, not false; the other fields still parse', () => {
  const row = normalizeEspnEvent(
    {
      competitions: [
        {
          date: '2026-09-13T17:00Z',
          status: { displayClock: '2:00', period: 2, type: { state: 'in' } },
          situation: {
            possession: '15',
            shortDownDistanceText: '2nd & 5',
            lastPlay: { text: 'Timeout, Kansas City' },
            // isRedZone key entirely absent — an unobserved fact, not "no".
          },
          competitors: [
            { homeAway: 'home', score: '10', team: { id: '15', abbreviation: 'KC' } },
            { homeAway: 'away', score: '14', team: { id: '28', abbreviation: 'DEN' } },
          ],
        },
      ],
    },
    { season: 2026, week: 2 }
  );
  assert.equal(row.isRedZone, null);
  assert.equal(row.possession, 'KC');
  assert.equal(row.downDistance, '2nd & 5');
  assert.equal(row.lastPlay, 'Timeout, Kansas City');
});

test('normalizeEspnEvent: possession that cannot be resolved is null, the other three fields still parse', () => {
  const row = normalizeEspnEvent(
    {
      competitions: [
        {
          date: '2026-09-13T17:00Z',
          status: { displayClock: '2:00', period: 2, type: { state: 'in' } },
          situation: {
            isRedZone: true,
            possession: 'not-a-competitor',
            shortDownDistanceText: '3rd & 2',
            lastPlay: { text: 'Timeout' },
          },
          competitors: [
            { homeAway: 'home', score: '10', team: { id: '15', abbreviation: 'KC' } },
            { homeAway: 'away', score: '14', team: { id: '28', abbreviation: 'DEN' } },
          ],
        },
      ],
    },
    { season: 2026, week: 2 }
  );
  assert.equal(row.possession, null);
  assert.equal(row.downDistance, '3rd & 2');
  assert.equal(row.isRedZone, true);
  assert.equal(row.lastPlay, 'Timeout');
});

test('normalizeEspnEvent: a scheduled event carries no Situation even if a stray block is present', () => {
  const row = normalizeEspnEvent(
    {
      competitions: [
        {
          date: '2026-09-13T17:00Z',
          status: { type: { state: 'pre' } },
          situation: { possession: '15', shortDownDistanceText: '1st & 10', isRedZone: false },
          competitors: [
            { homeAway: 'home', score: '0', team: { id: '15', abbreviation: 'KC' } },
            { homeAway: 'away', score: '0', team: { id: '28', abbreviation: 'DEN' } },
          ],
        },
      ],
    },
    { season: 2026, week: 2 }
  );
  assert.equal(row.gameStatus, 'scheduled');
  assert.equal(row.possession, null);
  assert.equal(row.downDistance, null);
  assert.equal(row.isRedZone, null);
  assert.equal(row.lastPlay, null);
});

test('normalizeEspnEvent: an in-progress event with the situation block absent (timeout/halftime) clears all four', () => {
  const row = normalizeEspnEvent(
    {
      competitions: [
        {
          date: '2026-09-13T17:00Z',
          status: { type: { state: 'in' } },
          competitors: [
            { homeAway: 'home', score: '10', team: { id: '15', abbreviation: 'KC' } },
            { homeAway: 'away', score: '14', team: { id: '28', abbreviation: 'DEN' } },
          ],
        },
      ],
    },
    { season: 2026, week: 2 }
  );
  assert.equal(row.gameStatus, 'in_progress');
  assert.equal(row.possession, null);
  assert.equal(row.downDistance, null);
  assert.equal(row.isRedZone, null);
  assert.equal(row.lastPlay, null);
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

// --- Venue, Broadcast, Record, win probability, linescores, headline (#1262, ADR 0038) ---

const gbAtChiEvent = () => ({
  competitions: [
    {
      date: '2026-09-13T17:00Z',
      status: { type: { state: 'post', completed: true } },
      venue: { fullName: 'Soldier Field', address: { city: 'Chicago' }, indoor: false },
      neutralSite: false,
      broadcasts: [{ names: ['FOX'] }, { names: ['NFL+'] }],
      headlines: [{ shortLinkText: 'Packers hold off Bears in division opener' }],
      competitors: [
        {
          homeAway: 'home',
          score: '20',
          team: { abbreviation: 'CHI' },
          records: [
            { type: 'total', summary: '5-7' },
            { type: 'home', summary: '3-3' },
            { type: 'road', summary: '2-4' },
          ],
          linescores: [{ value: 0 }, { value: 7 }, { value: 6 }, { value: 7 }],
        },
        {
          homeAway: 'away',
          score: '24',
          team: { abbreviation: 'GB' },
          records: [
            { type: 'total', summary: '10-2' },
            { type: 'home', summary: '6-0' },
            { type: 'road', summary: '4-2' },
          ],
          linescores: [{ value: 7 }, { value: 10 }, { value: 0 }, { value: 7 }],
        },
      ],
    },
  ],
});

test('normalizeEspnEvent: every Venue/Broadcast/Record/linescores/headline field present parses fully (#1262)', () => {
  const row = normalizeEspnEvent(gbAtChiEvent(), { season: 2026, week: 2 });
  assert.equal(row.venueName, 'Soldier Field');
  assert.equal(row.venueCity, 'Chicago');
  assert.equal(row.isIndoor, false);
  assert.equal(row.isNeutralSite, false);
  assert.equal(row.broadcast, 'FOX, NFL+'); // every broadcasts[].names entry flattened and joined
  assert.deepEqual(row.homeRecord, { total: '5-7', home: '3-3', road: '2-4' });
  assert.deepEqual(row.awayRecord, { total: '10-2', home: '6-0', road: '4-2' });
  assert.deepEqual(row.linescores, { home: [0, 7, 6, 7], away: [7, 10, 0, 7] });
  assert.equal(row.headline, 'Packers hold off Bears in division opener');
});

test('normalizeEspnEvent: every Venue/Broadcast/Record/linescores/headline field absent maps to null, never a placeholder (#1262)', () => {
  const row = normalizeEspnEvent(
    {
      competitions: [
        {
          date: '2026-09-13T17:00Z',
          status: { type: { state: 'pre' } },
          competitors: [
            { homeAway: 'home', score: '0', team: { abbreviation: 'CHI' } },
            { homeAway: 'away', score: '0', team: { abbreviation: 'GB' } },
          ],
        },
      ],
    },
    { season: 2026, week: 2 }
  );
  assert.equal(row.venueName, null);
  assert.equal(row.venueCity, null);
  assert.equal(row.isIndoor, null);
  assert.equal(row.isNeutralSite, null);
  assert.equal(row.broadcast, null);
  assert.equal(row.homeRecord, null);
  assert.equal(row.awayRecord, null);
  assert.equal(row.linescores, null);
  assert.equal(row.headline, null);
});

test('normalizeEspnEvent: a neutral-site game drops the home/road Record split and keeps the total (CONTEXT.md Venue, #1262)', () => {
  const event = gbAtChiEvent();
  event.competitions[0].neutralSite = true;
  const row = normalizeEspnEvent(event, { season: 2026, week: 2 });
  assert.equal(row.isNeutralSite, true);
  assert.deepEqual(row.homeRecord, { total: '5-7', home: null, road: null });
  assert.deepEqual(row.awayRecord, { total: '10-2', home: null, road: null });
});

test('normalizeEspnEvent: an in-progress event with a probability block carries home win probability, folded into Situation (#1262)', () => {
  const row = normalizeEspnEvent(
    {
      competitions: [
        {
          date: '2026-09-13T17:00Z',
          status: { displayClock: '5:00', period: 3, type: { state: 'in' } },
          situation: {
            possession: '15',
            shortDownDistanceText: '2nd & 5',
            isRedZone: false,
            lastPlay: { text: 'Timeout', probability: { homeWinPercentage: 0.732 } },
          },
          competitors: [
            { homeAway: 'home', score: '17', team: { id: '15', abbreviation: 'KC' } },
            { homeAway: 'away', score: '14', team: { id: '28', abbreviation: 'DEN' } },
          ],
        },
      ],
    },
    { season: 2026, week: 2 }
  );
  assert.equal(row.homeWinProbability, 0.732);
});

test('normalizeEspnEvent: a situation block with no probability, or no lastPlay at all, leaves home win probability null (#1262)', () => {
  const noProbability = normalizeEspnEvent(
    {
      competitions: [
        {
          date: '2026-09-13T17:00Z',
          status: { displayClock: '5:00', period: 3, type: { state: 'in' } },
          situation: { possession: '15', isRedZone: false, lastPlay: { text: 'Timeout' } },
          competitors: [
            { homeAway: 'home', score: '17', team: { id: '15', abbreviation: 'KC' } },
            { homeAway: 'away', score: '14', team: { id: '28', abbreviation: 'DEN' } },
          ],
        },
      ],
    },
    { season: 2026, week: 2 }
  );
  assert.equal(noProbability.homeWinProbability, null);

  const noLastPlay = normalizeEspnEvent(
    {
      competitions: [
        {
          date: '2026-09-13T17:00Z',
          status: { displayClock: '5:00', period: 3, type: { state: 'in' } },
          situation: { possession: '15', isRedZone: false },
          competitors: [
            { homeAway: 'home', score: '17', team: { id: '15', abbreviation: 'KC' } },
            { homeAway: 'away', score: '14', team: { id: '28', abbreviation: 'DEN' } },
          ],
        },
      ],
    },
    { season: 2026, week: 2 }
  );
  assert.equal(noLastPlay.homeWinProbability, null);
});

test('normalizeEspnEvent: a Washington game normalizes its team code consistently across every new field too (#1262 AC4)', () => {
  // espnScoreboard.js's own documented rule (see ESPN_TO_OUR_ABBR above):
  // this module's team-code columns (tank01GameId/homeTeam/awayTeam,
  // possession, and now Venue/Broadcast/Record) all fold through the SAME
  // espnAbbrToOurs as Tank01's own join-key spelling, WSH — never a second,
  // inconsistent path that could leave a stray 'WAS' on one field and 'WSH'
  // on another for the same game.
  const row = normalizeEspnEvent(
    {
      competitions: [
        {
          date: '2026-09-13T17:00Z',
          status: { type: { state: 'pre' } },
          venue: { fullName: 'Northwest Stadium', address: { city: 'Landover' }, indoor: false },
          neutralSite: false,
          broadcasts: [{ names: ['FOX'] }],
          competitors: [
            {
              homeAway: 'home',
              score: '0',
              team: { abbreviation: 'WAS' }, // ESPN spells it WAS
              records: [{ type: 'total', summary: '4-8' }],
            },
            {
              homeAway: 'away',
              score: '0',
              team: { abbreviation: 'NYG' },
              records: [{ type: 'total', summary: '6-6' }],
            },
          ],
        },
      ],
    },
    { season: 2026, week: 2 }
  );
  assert.equal(row.homeTeam, 'WSH', 'never WAS, even though ESPN spelled it WAS');
  assert.equal(row.tank01GameId, '20260913_NYG@WSH');
  // Record is keyed by home/away position, not by team code, so it carries no
  // separate WAS/WSH spelling of its own to drift out of sync.
  assert.deepEqual(row.homeRecord, { total: '4-8', home: null, road: null });
  assert.deepEqual(row.awayRecord, { total: '6-6', home: null, road: null });
});

// --- pure normalizers, unit-level (#1262) ------------------------------------

test('normalizeVenue: reads fullName/address.city/indoor, all null when absent', () => {
  assert.deepEqual(normalizeVenue({ fullName: 'Lambeau Field', address: { city: 'Green Bay' }, indoor: false }), {
    venueName: 'Lambeau Field',
    venueCity: 'Green Bay',
    isIndoor: false,
  });
  assert.deepEqual(normalizeVenue(null), { venueName: null, venueCity: null, isIndoor: null });
  assert.deepEqual(normalizeVenue({}), { venueName: null, venueCity: null, isIndoor: null });
});

test('normalizeBroadcast: flattens every entry\'s names, null when there are none', () => {
  assert.equal(normalizeBroadcast([{ names: ['CBS'] }]), 'CBS');
  assert.equal(normalizeBroadcast([{ names: ['CBS'] }, { names: ['Paramount+', 'NFL+'] }]), 'CBS, Paramount+, NFL+');
  assert.equal(normalizeBroadcast([]), null);
  assert.equal(normalizeBroadcast(null), null);
  assert.equal(normalizeBroadcast([{ names: [] }]), null);
});

test('normalizeRecord: three cuts by type, null when nothing usable, neutral site drops the split', () => {
  const records = [
    { type: 'total', summary: '8-4' },
    { type: 'home', summary: '5-1' },
    { type: 'road', summary: '3-3' },
  ];
  assert.deepEqual(normalizeRecord(records), { total: '8-4', home: '5-1', road: '3-3' });
  assert.deepEqual(normalizeRecord(records, { isNeutralSite: true }), { total: '8-4', home: null, road: null });
  assert.equal(normalizeRecord(null), null);
  assert.equal(normalizeRecord([]), null);
  assert.equal(normalizeRecord([{ type: 'total', summary: '' }]), null);
});

test('normalizeRecord: a neutral site with no usable total is null, never an all-null placeholder (#1262 qa-reviewer finding 3)', () => {
  const homeRoadOnly = [
    { type: 'home', summary: '5-1' },
    { type: 'road', summary: '3-3' },
  ];
  assert.equal(normalizeRecord(homeRoadOnly, { isNeutralSite: true }), null);
  // Off a neutral site the same input still returns the split (no total, though).
  assert.deepEqual(normalizeRecord(homeRoadOnly), { total: null, home: '5-1', road: '3-3' });
});

test('normalizeLinescoreValues: a missing per-quarter value is null, not dropped; empty/absent is null', () => {
  assert.deepEqual(normalizeLinescoreValues([{ value: 7 }, {}, { value: 3 }]), [7, null, 3]);
  assert.equal(normalizeLinescoreValues([]), null);
  assert.equal(normalizeLinescoreValues(null), null);
});

test('normalizeHeadline: reads headlines[0].shortLinkText, null when absent', () => {
  assert.equal(normalizeHeadline([{ shortLinkText: 'Big win' }]), 'Big win');
  assert.equal(normalizeHeadline([]), null);
  assert.equal(normalizeHeadline(null), null);
  assert.equal(normalizeHeadline([{}]), null);
});

// --- whole-payload normalization --------------------------------------------

test('normalizeEspnScoreboard: a real 16-game week (plus one in-progress fixture event for Situation, #1233) normalizes completely', () => {
  const { rows, dropped } = normalizeEspnScoreboard(fixture, { season: 2025, week: 1 });
  assert.equal(rows.length, 17);
  assert.deepEqual(dropped, []);
  for (const row of rows) {
    assert.match(row.tank01GameId, /^\d{8}_[A-Z]{2,3}@[A-Z]{2,3}$/);
    assert.equal(row.season, 2025);
    assert.equal(row.week, 1);
    assert.ok(['scheduled', 'in_progress', 'final'].includes(row.gameStatus));
  }
  assert.equal(new Set(rows.map((r) => r.tank01GameId)).size, 17, 'ids are unique');
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
  assert.equal(rows.length, 17);
});
