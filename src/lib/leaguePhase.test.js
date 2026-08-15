import { deriveLeaguePhase, LEAGUE_PHASE, rosterActionForPhase } from './leaguePhase';

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
