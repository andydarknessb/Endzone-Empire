import {
  deriveLeaguePhase,
  frozenSettingKeys,
  isSeasonLive,
  joinability,
  JOIN_REFUSAL_REASON,
  LEAGUE_PHASE,
  rosterActionForPhase,
} from './leaguePhase';
import fixture from './leaguePhase.fixture.json';

// The phase / joinability contract fixture is shared with the server phase
// test (server/test/leaguePhase.test.js loads this same file), so the two
// derivations cannot drift silently: every case asserts phase, joinable and
// reason on both sides.
test.each(fixture.cases.map((c) => [c.name, c]))('fixture: %s', (_name, c) => {
  expect(deriveLeaguePhase(c.league)).toBe(c.phase);
  // A joinable answer carries no reason key at all; a refusal carries the
  // fixture's reason (null only for a missing row).
  expect(joinability(c.league)).toEqual(c.joinable ? { joinable: true } : { joinable: false, reason: c.reason });
});

test('the reason strings are the cross-side contract the fixture carries', () => {
  expect(JOIN_REFUSAL_REASON).toEqual({ DRAFT_STARTED: 'draft-started', SEASON_COMPLETE: 'season-complete' });
  const reasons = new Set(fixture.cases.map((c) => c.reason).filter(Boolean));
  expect([...reasons].sort()).toEqual(Object.values(JOIN_REFUSAL_REASON).sort());
});

test.each([
  [{ draft_status: 'pending' }, LEAGUE_PHASE.PRE_DRAFT],
  [{ draft_status: 'active' }, LEAGUE_PHASE.DRAFTING],
  [{ draft_status: 'complete', season_status: 'regular' }, LEAGUE_PHASE.IN_SEASON],
  [{ draft_status: 'complete', season_status: 'playoffs' }, LEAGUE_PHASE.PLAYOFFS],
  [{ draft_status: 'complete', season_status: 'complete' }, LEAGUE_PHASE.COMPLETE],
])('deriveLeaguePhase maps existing league fields to %s', (league, expected) => {
  expect(deriveLeaguePhase(league)).toBe(expected);
});

test('rosterActionForPhase keeps draft and completed-season adds unambiguous', () => {
  expect(rosterActionForPhase({ draft_status: 'pending' })).toMatchObject({ label: 'Draft not started', disabled: true });
  expect(rosterActionForPhase({ draft_status: 'active' })).toMatchObject({ label: 'Open Draft Room', disabled: true });
  expect(rosterActionForPhase({ draft_status: 'complete', season_status: 'regular' })).toMatchObject({ label: 'Add free agent', disabled: false });
  expect(rosterActionForPhase({ draft_status: 'complete', season_status: 'complete' })).toMatchObject({ label: 'Season complete', disabled: true });
});

// A pick'em-only league has no draft, so its phase ignores draft_status:
// it is in season from creation until the season completes.
test.each([
  [{ pickem_only: true, draft_status: 'pending', season_status: 'regular' }, LEAGUE_PHASE.IN_SEASON],
  [{ pickem_only: true, draft_status: 'pending' }, LEAGUE_PHASE.IN_SEASON],
  [{ pickem_only: true, draft_status: 'active', season_status: 'playoffs' }, LEAGUE_PHASE.IN_SEASON],
  [{ pickem_only: true, draft_status: 'pending', season_status: 'complete' }, LEAGUE_PHASE.COMPLETE],
])("deriveLeaguePhase for a pick'em-only league %j is %s", (league, expected) => {
  expect(deriveLeaguePhase(league)).toBe(expected);
});

test("rosterActionForPhase is disabled for a pick'em-only league because it has no rosters", () => {
  expect(rosterActionForPhase({ pickem_only: true, draft_status: 'pending' })).toEqual({
    label: 'No rosters',
    disabled: true,
    helper: "This is a pick'em league. There are no rosters.",
  });
});

test('isSeasonLive is true only in season and in the playoffs (the week can advance, matchups score live)', () => {
  expect(isSeasonLive({ draft_status: 'pending' })).toBe(false);
  expect(isSeasonLive({ draft_status: 'active' })).toBe(false);
  expect(isSeasonLive({ draft_status: 'complete', season_status: 'regular' })).toBe(true);
  expect(isSeasonLive({ draft_status: 'complete', season_status: 'playoffs' })).toBe(true);
  expect(isSeasonLive({ draft_status: 'complete', season_status: 'complete' })).toBe(false);
  expect(isSeasonLive({ pickem_only: true, draft_status: 'pending', season_status: 'regular' })).toBe(true);
  expect(isSeasonLive({ pickem_only: true, draft_status: 'pending', season_status: 'complete' })).toBe(false);
  expect(isSeasonLive(null)).toBe(false);
});

// The settings freeze: the commissioner-tools panels grey out exactly the
// keys the server refuses once the draft starts, and nothing else.
test('frozenSettingKeys is empty pre-draft, the full list past pre-draft, and empty for a pick\'em-only league', () => {
  expect(frozenSettingKeys({ draft_status: 'pending' })).toEqual([]);
  expect(frozenSettingKeys({ draft_status: 'active' })).toContain('rosterSlots');
  expect(frozenSettingKeys({ draft_status: 'complete', season_status: 'regular' })).toContain('scoringRules');
  expect(frozenSettingKeys({ draft_status: 'complete', season_status: 'complete' })).toContain('playoffTeams');
  expect(frozenSettingKeys({ pickem_only: true, draft_status: 'complete', season_status: 'complete' })).toEqual([]);
  expect(frozenSettingKeys(null).length).toBeGreaterThan(0);
});

// The whole point of this module is that it agrees with the server. Anything
// the client would grey out or allow, the server must refuse or accept for
// the same row (prior art: src/lib/draftTurns.test.js).
describe('parity with server/services/leaguePhase.js', () => {
  // eslint-disable-next-line global-require
  const server = require('../../server/services/leaguePhase');

  test('the draft-frozen setting keys are the same list', () => {
    expect(frozenSettingKeys({ draft_status: 'active' })).toEqual([...server.DRAFT_FROZEN_SETTING_KEYS]);
  });

  test.each(fixture.cases.map((c) => [c.name, c.league]))('phase, joinability and frozen keys agree: %s', (_name, league) => {
    expect(deriveLeaguePhase(league)).toBe(server.deriveLeaguePhase(league));
    expect(joinability(league)).toEqual(server.joinability(league));
    expect(frozenSettingKeys(league)).toEqual(server.frozenSettingKeys(league));
  });
});
