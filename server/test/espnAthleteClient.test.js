const test = require('node:test');
const assert = require('node:assert/strict');
const athleteProfileFixture = require('./fixtures/espn/athlete-profile.json');
const athleteOverviewFixture = require('./fixtures/espn/athlete-overview.json');
const teamDepthChartFixture = require('./fixtures/espn/team-depth-chart.json');
const fantasyPlayerInfoFixture = require('./fixtures/espn/fantasy-player-info.json');
const {
  profile,
  overview,
  teamDepthChart,
  ownership,
  normalizeBio,
  normalizeEspnNews,
  normalizeInjuryFacts,
  normalizeDepthChart,
  normalizeOwnership,
  refId,
  ESPN_TEAM_NUMERIC_ID,
} = require('../modules/espnAthleteClient');

/** A fake axios-like transport: resolves/rejects per call, and counts calls. */
function fakeTransport(handler) {
  const calls = [];
  return {
    calls,
    get: async (url, config) => {
      calls.push({ url, config });
      return handler(url, config);
    },
  };
}

function okResponse(data) {
  return { data };
}

function httpError(status) {
  const err = new Error(`Request failed with status code ${status}`);
  err.response = { status };
  return err;
}

// --- pure normalizers, against the real captured fixtures -------------------

test('normalizeBio: athlete-profile.json maps to bio', () => {
  const bio = normalizeBio(athleteProfileFixture);
  assert.equal(bio.age, 24);
  assert.equal(bio.height, `6' 4"`);
  assert.equal(bio.weight, '225 lbs');
  assert.equal(bio.college, 'North Carolina');
  assert.equal(bio.experience, '3rd Season');
  assert.equal(bio.draft, '2024: Rd 1, Pk 3 (NE)');
});

test('normalizeEspnNews: athlete-overview.json maps to news[] ordered newest first', () => {
  const news = normalizeEspnNews(athleteOverviewFixture);
  assert.ok(news.length > 0);
  assert.equal(news[0].source, 'espn');
  assert.ok(typeof news[0].headline === 'string' && news[0].headline.length > 0);
  const timestamps = news.map((n) => new Date(n.publishedAt).getTime());
  const sorted = [...timestamps].sort((a, b) => b - a);
  assert.deepEqual(timestamps, sorted, 'ESPN already orders news newest-first; we must not reorder it');
});

test('normalizeInjuryFacts: no injuries[] entry on the fixture -> null (healthy player)', () => {
  assert.equal(normalizeInjuryFacts(athleteOverviewFixture), null);
});

test('normalizeInjuryFacts: a synthetic injuries[] entry maps to type/practiceNote/expectedReturn', () => {
  const facts = normalizeInjuryFacts({
    injuries: [{
      status: 'Questionable',
      shortComment: 'Limited in practice Thursday.',
      details: { type: 'Ankle', returnDate: '2026-09-21' },
    }],
  });
  assert.deepEqual(facts, {
    type: 'Ankle',
    practiceNote: 'Limited in practice Thursday.',
    expectedReturn: '2026-09-21',
  });
});

test('normalizeInjuryFacts: absent injuries key -> null', () => {
  assert.equal(normalizeInjuryFacts({}), null);
  assert.equal(normalizeInjuryFacts(null), null);
});

test('refId: parses the trailing numeric id off a core-API $ref', () => {
  assert.equal(refId({ $ref: 'https://.../seasons/2025/athletes/4372030?lang=en&region=us' }), '4372030');
  assert.equal(refId('https://.../athletes/99'), '99');
  assert.equal(refId(null), null);
  assert.equal(refId({}), null);
});

test('normalizeDepthChart: team-depth-chart.json maps to flat {athleteId, teamCode, positionGroup, rank} rows', () => {
  const rows = normalizeDepthChart(teamDepthChartFixture, 'NE');
  assert.ok(rows.length > 0);
  for (const row of rows) {
    assert.equal(row.teamCode, 'NE');
    assert.match(row.athleteId, /^\d+$/);
    assert.ok(row.positionGroup === null || typeof row.positionGroup === 'string');
    assert.ok(row.rank === null || typeof row.rank === 'number');
  }
});

test('normalizeOwnership: fantasy-player-info.json maps to {athleteId, percentOwned, percentStarted, percentChange}, no projection field reaches it', () => {
  const rows = normalizeOwnership(fantasyPlayerInfoFixture);
  assert.equal(rows.length, 1);
  const [row] = rows;
  assert.equal(row.athleteId, '4431452');
  assert.equal(typeof row.percentOwned, 'number');
  assert.equal(typeof row.percentStarted, 'number');
  assert.equal(typeof row.percentChange, 'number');
  assert.deepEqual(Object.keys(row).sort(), ['athleteId', 'percentChange', 'percentOwned', 'percentStarted']);
});

test('ESPN_TEAM_NUMERIC_ID: NE is 17, all 32 our-canonical codes are present', () => {
  assert.equal(ESPN_TEAM_NUMERIC_ID.NE, 17);
  assert.equal(Object.keys(ESPN_TEAM_NUMERIC_ID).length, 32);
  assert.equal(ESPN_TEAM_NUMERIC_ID.WAS, 28); // our canonical code, not ESPN's own WSH
});

// --- profile()/overview(): failure resolution + caching ---------------------

test('profile: a 403 resolves null, not a throw', async () => {
  const transport = fakeTransport(() => { throw httpError(403); });
  const bio = await profile('9990001', { transport });
  assert.equal(bio, null);
});

test('profile: a timeout resolves null, not a throw', async () => {
  const transport = fakeTransport(() => { throw new Error('timeout of 10000ms exceeded'); });
  const bio = await profile('9990002', { transport });
  assert.equal(bio, null);
});

test('profile: a missing id resolves null with no transport call', async () => {
  const transport = fakeTransport(() => okResponse({ athlete: {} }));
  assert.equal(await profile(null, { transport }), null);
  assert.equal(await profile(undefined, { transport }), null);
  assert.equal(transport.calls.length, 0);
});

test('profile: two calls for the same athlete inside six hours make one transport call', async () => {
  const transport = fakeTransport(() => okResponse(athleteProfileFixture));
  const first = await profile('9990003', { transport });
  const second = await profile('9990003', { transport });
  assert.deepEqual(first, second);
  assert.equal(transport.calls.length, 1);
});

test('profile: two calls after a 403 inside five minutes make one transport call (negative cache)', async () => {
  const transport = fakeTransport(() => { throw httpError(403); });
  const first = await profile('9990004', { transport });
  const second = await profile('9990004', { transport });
  assert.equal(first, null);
  assert.equal(second, null);
  assert.equal(transport.calls.length, 1);
});

test('overview: a 403 resolves null, not a throw, and getPlayerCard-facing shape is {news, injuryFacts} on success', async () => {
  const failing = fakeTransport(() => { throw httpError(403); });
  assert.equal(await overview('9990005', { transport: failing }), null);

  const ok = fakeTransport(() => okResponse(athleteOverviewFixture));
  const result = await overview('9990006', { transport: ok });
  assert.ok(Array.isArray(result.news));
  assert.equal(result.injuryFacts, null);
});

test('overview: two calls inside six hours make one transport call', async () => {
  const transport = fakeTransport(() => okResponse(athleteOverviewFixture));
  await overview('9990007', { transport });
  await overview('9990007', { transport });
  assert.equal(transport.calls.length, 1);
});

// --- teamDepthChart()/ownership(): never cached, never throw ----------------

test('teamDepthChart: an unknown team code resolves [] with no transport call', async () => {
  const transport = fakeTransport(() => okResponse(teamDepthChartFixture));
  const rows = await teamDepthChart('ZZ', { transport });
  assert.deepEqual(rows, []);
  assert.equal(transport.calls.length, 0);
});

test('teamDepthChart: a fetch failure resolves [] rather than throwing', async () => {
  const transport = fakeTransport(() => { throw httpError(403); });
  const rows = await teamDepthChart('NE', { transport });
  assert.deepEqual(rows, []);
});

test('teamDepthChart: NE resolves real rows from the fixture and is never cached (two calls, two transport hits)', async () => {
  const transport = fakeTransport(() => okResponse(teamDepthChartFixture));
  const first = await teamDepthChart('NE', { transport });
  const second = await teamDepthChart('NE', { transport });
  assert.ok(first.length > 0);
  assert.deepEqual(first, second);
  assert.equal(transport.calls.length, 2);
});

test('ownership: a fetch failure resolves [] rather than throwing', async () => {
  const transport = fakeTransport(() => { throw httpError(403); });
  assert.deepEqual(await ownership({ transport }), []);
});

test('ownership: resolves real rows from the fixture and is never cached (two calls, two transport hits)', async () => {
  const transport = fakeTransport(() => okResponse(fantasyPlayerInfoFixture));
  const first = await ownership({ transport });
  const second = await ownership({ transport });
  assert.equal(first.length, 1);
  assert.deepEqual(first, second);
  assert.equal(transport.calls.length, 2);
});
