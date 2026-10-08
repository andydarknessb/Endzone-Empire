import {
  matchupFromListRow,
  matchupFromDetailBody,
  applyScoreEvent,
  applyIdentityPatch,
  matchupResultLine,
  viewerMatchupOf,
} from './matchupModel';

// A list row exactly as GET /api/league/:id/matchups delivers it
// (matchups.* joined to the two teams, then attachExpectedFinals decorated).
const listRow = {
  id: 5,
  season: 2025,
  week: 3,
  final: false,
  status: 'live',
  nfl_game_ids: ['20250911_DAL@PHI', '20250914_SF@LAR'],
  home_team_id: 10,
  home_team_name: 'Home Town',
  home_team_avatar_url: 'home.png',
  home_team_avatar_static_url: 'home-static.png',
  home_score: 41.2,
  home_expected_final: 104.6,
  home_players_remaining: 5,
  away_team_id: 20,
  away_team_name: 'Away Days',
  away_team_avatar_url: 'away.png',
  away_team_avatar_static_url: 'away-static.png',
  away_score: 55.9,
  away_expected_final: 131.3,
  away_players_remaining: 4,
};

// The detail body: { matchup, home, away }, score on the matchup, identity and
// figures on the per-side objects.
const detailBody = {
  matchup: { id: 5, season: 2025, week: 3, final: false, status: 'played', home_score: 88, away_score: 77 },
  home: { teamId: 10, name: 'Home Town', expectedFinal: 88, playersRemaining: 0 },
  away: { teamId: 20, name: 'Away Days', expectedFinal: 77, playersRemaining: 0 },
};

describe('matchupFromListRow / matchupFromDetailBody: one shape from any wire', () => {
  test('a list row becomes the one per-side shape', () => {
    expect(matchupFromListRow(listRow)).toEqual({
      id: 5,
      season: 2025,
      week: 3,
      final: false,
      status: 'live',
      nflGameIds: ['20250911_DAL@PHI', '20250914_SF@LAR'],
      firstKickoffAt: null,
      syncedAt: null,
      narrative: null,
      home: {
        teamId: 10,
        name: 'Home Town',
        avatarUrl: 'home.png',
        avatarStaticUrl: 'home-static.png',
        score: 41.2,
        expectedFinal: 104.6,
        playersRemaining: 5,
      },
      away: {
        teamId: 20,
        name: 'Away Days',
        avatarUrl: 'away.png',
        avatarStaticUrl: 'away-static.png',
        score: 55.9,
        expectedFinal: 131.3,
        playersRemaining: 4,
      },
    });
  });

  test('a detail body becomes the same per-side shape (score off the matchup, no avatar on the wire)', () => {
    expect(matchupFromDetailBody(detailBody)).toEqual({
      id: 5,
      season: 2025,
      week: 3,
      final: false,
      status: 'played',
      firstKickoffAt: null,
      syncedAt: null,
      home: {
        teamId: 10,
        name: 'Home Town',
        avatarUrl: null,
        avatarStaticUrl: null,
        score: 88,
        expectedFinal: 88,
        playersRemaining: 0,
      },
      away: {
        teamId: 20,
        name: 'Away Days',
        avatarUrl: null,
        avatarStaticUrl: null,
        score: 77,
        expectedFinal: 77,
        playersRemaining: 0,
      },
    });
  });
});

describe('applyScoreEvent: a live entry applied to a model', () => {
  const base = matchupFromListRow({
    id: 5,
    season: 2025,
    week: 3,
    final: false,
    status: 'scheduled',
    home_team_id: 10,
    home_team_name: 'Home Town',
    home_score: 0,
    home_expected_final: 100,
    home_players_remaining: 9,
    away_team_id: 20,
    away_team_name: 'Away Days',
    away_score: 0,
    away_expected_final: 140,
    away_players_remaining: 9,
  });

  test('a full entry moves the scores, figures and status, keeping each side its own identity', () => {
    const next = applyScoreEvent(base, {
      matchupId: 5,
      status: 'live',
      homeScore: 41.2,
      awayScore: 55.9,
      homeExpectedFinal: 104.6,
      awayExpectedFinal: 131.3,
      homePlayersRemaining: 5,
      awayPlayersRemaining: 4,
    });

    expect(next.status).toBe('live');
    // Home keeps HOME's identity and takes HOME's new numbers (this is the
    // case a home/away swap in the list-row builder turns red).
    expect(next.home).toEqual({
      teamId: 10,
      name: 'Home Town',
      avatarUrl: null,
      avatarStaticUrl: null,
      score: 41.2,
      expectedFinal: 104.6,
      playersRemaining: 5,
    });
    expect(next.away.name).toBe('Away Days');
    expect(next.away.score).toBe(55.9);
    expect(next.away.playersRemaining).toBe(4);
    // A new object, so a memoised reader recomputes; the input is untouched.
    expect(next).not.toBe(base);
    expect(base.home.score).toBe(0);
  });

  test('an older entry missing the four figure fields leaves them untouched (scores still move)', () => {
    const next = applyScoreEvent(base, { matchupId: 5, homeScore: 12, awayScore: 3 });

    expect(next.home.score).toBe(12);
    expect(next.away.score).toBe(3);
    // The four fields the older entry did not carry are left exactly as they were.
    expect(next.home.expectedFinal).toBe(100);
    expect(next.away.expectedFinal).toBe(140);
    expect(next.home.playersRemaining).toBe(9);
    expect(next.away.playersRemaining).toBe(9);
    // No status on the entry means the model's status stands.
    expect(next.status).toBe('scheduled');
  });

  test('an entry for another matchup is a no-op', () => {
    expect(applyScoreEvent(base, { matchupId: 999, homeScore: 1, awayScore: 2 })).toBe(base);
  });
});

describe('applyIdentityPatch: a Team identity update per side', () => {
  const base = matchupFromListRow(listRow);
  // Keyed by teamId, never by home/away position: this case reads identity, not
  // the score/figure fields, so a home/away swap in the list-row builder must
  // NOT turn it red (AC1: the identity-patch case is exempt from that red-tell).
  const sideOf = (model, teamId) => [model.home, model.away].find((s) => s.teamId === teamId);

  test('patches only the side whose teamId matches, leaving the other alone', () => {
    const team10Before = sideOf(base, 10);
    const next = applyIdentityPatch(base, {
      leagueId: 1,
      teamId: 20,
      name: 'Renamed Away',
      avatarUrl: 'new-away.png',
      avatarStaticUrl: 'new-away-static.png',
    });

    // Team 20 is renamed and re-avatared, wherever it sits...
    const team20After = sideOf(next, 20);
    expect(team20After.name).toBe('Renamed Away');
    expect(team20After.avatarUrl).toBe('new-away.png');
    expect(team20After.avatarStaticUrl).toBe('new-away-static.png');
    // ...and team 10 is returned exactly as it was (same reference, untouched).
    expect(sideOf(next, 10)).toBe(team10Before);
  });

  test('a patch for a Team in neither side changes nothing', () => {
    const next = applyIdentityPatch(base, { leagueId: 1, teamId: 999, name: 'Nobody' });
    expect(next.home).toBe(base.home);
    expect(next.away).toBe(base.away);
  });
});

// pairStartersBySlot's own tests moved to entities/roster/model/lineupModel.test.js
// (#1210, R5 of #1198: tests replace, not layer - the function itself moved
// there in #1207, this module's copies were a duplicate, and #1210 closed the
// one-release re-export that was their last reason to exist here).

// ---------------------------------------------------------------------------
// #892: the two week facts, first kickoff and sync time, on every wire.
// ---------------------------------------------------------------------------
describe('firstKickoffAt and syncedAt (#892)', () => {
  test('a list row maps first_kickoff_at and synced_at, null when absent', () => {
    const withFacts = matchupFromListRow({ ...listRow, first_kickoff_at: '2025-09-21T17:00:00.000Z', synced_at: '2025-09-21T19:42:00.000Z' });
    expect(withFacts.firstKickoffAt).toBe('2025-09-21T17:00:00.000Z');
    expect(withFacts.syncedAt).toBe('2025-09-21T19:42:00.000Z');
    const without = matchupFromListRow(listRow);
    expect(without.firstKickoffAt).toBeNull();
    expect(without.syncedAt).toBeNull();
  });

  test('a detail body maps them off the matchup object', () => {
    const model = matchupFromDetailBody({
      ...detailBody,
      matchup: { ...detailBody.matchup, first_kickoff_at: '2025-09-21T17:00:00.000Z', synced_at: '2025-09-21T19:42:00.000Z' },
    });
    expect(model.firstKickoffAt).toBe('2025-09-21T17:00:00.000Z');
    expect(model.syncedAt).toBe('2025-09-21T19:42:00.000Z');
  });

  test('a score event moves them only when carried; an older entry leaves them untouched', () => {
    const base = matchupFromListRow({ ...listRow, first_kickoff_at: '2025-09-21T17:00:00.000Z', synced_at: '2025-09-21T19:42:00.000Z' });
    const older = applyScoreEvent(base, { matchupId: 5, homeScore: 50, awayScore: 60 });
    expect(older.firstKickoffAt).toBe('2025-09-21T17:00:00.000Z');
    expect(older.syncedAt).toBe('2025-09-21T19:42:00.000Z');
    const newer = applyScoreEvent(base, { matchupId: 5, homeScore: 50, awayScore: 60, syncedAt: '2025-09-21T20:12:00.000Z', firstKickoffAt: null });
    expect(newer.syncedAt).toBe('2025-09-21T20:12:00.000Z');
    expect(newer.firstKickoffAt).toBeNull();
  });
});

describe('viewerMatchupOf (#1872)', () => {
  const mine = matchupFromListRow({ ...listRow, id: 1, home_team_id: 3, away_team_id: 7 });
  const awayMine = matchupFromListRow({ ...listRow, id: 2, home_team_id: 8, away_team_id: 3 });
  const other = matchupFromListRow({ ...listRow, id: 3, home_team_id: 4, away_team_id: 5 });

  test('picks the Matchup the viewer Team is home in', () => {
    expect(viewerMatchupOf([other, mine], 3)).toBe(mine);
  });

  test('picks the Matchup the viewer Team is away in', () => {
    expect(viewerMatchupOf([other, awayMine], 3)).toBe(awayMine);
  });

  test('is null with no viewer Team, no row for the viewer, or a non-list', () => {
    expect(viewerMatchupOf([mine], null)).toBeNull();
    expect(viewerMatchupOf([other], 3)).toBeNull();
    expect(viewerMatchupOf(null, 3)).toBeNull();
    expect(viewerMatchupOf([null, other], 3)).toBeNull();
  });
});

describe('matchupResultLine (#2007)', () => {
  const m = (status, homeScore, awayScore) => ({
    status,
    home: { teamId: 12, name: 'Duluth Dockworkers', score: homeScore },
    away: { teamId: 34, name: 'Fargo Frostbite', score: awayScore },
  });

  test.each([
    ['final', 115.9, 109.7, 12, 'You won by 6.2'],
    ['final', 109.7, 115.9, 12, 'You lost by 6.2'],
    ['final', 109.7, 115.9, 34, 'You won by 6.2'],
    ['final', 115.9, 109.7, 34, 'You lost by 6.2'],
    ['final', 115.9, 109.7, 99, 'Duluth Dockworkers won by 6.2'],
    ['final', 109.7, 115.9, null, 'Fargo Frostbite won by 6.2'],
    ['final', 100, 100, 12, 'Tied'],
    ['final', '115.90', '109.70', 12, 'You won by 6.2'],
    ['final', 100.04, 100, 12, 'You won by 0.04'],
    ['final', 100, 100.04, 12, 'You lost by 0.04'],
    ['final', 100.04, 99.96, 12, 'You won by 0.08'],
    ['final', 100.06, 99.94, 12, 'You won by 0.1'],
    ['played', 100, 100.04, 99, 'Unofficial: Fargo Frostbite won by 0.04'],
    ['played', 115.9, 109.7, 12, 'Unofficial: You won by 6.2'],
    ['played', 115.9, 109.7, 99, 'Unofficial: Duluth Dockworkers won by 6.2'],
    ['played', 100, 100, 12, 'Unofficial: Tied'],
  ])('%s %s to %s, viewer %s reads "%s"', (status, home, away, viewer, line) => {
    expect(matchupResultLine(m(status, home, away), viewer)).toBe(line);
  });

  test.each(['scheduled', 'live', null, 'postponed'])('a %s matchup has no result line', (status) => {
    expect(matchupResultLine(m(status, 115.9, 109.7), 12)).toBeNull();
  });

  test.each([null, undefined, '', 'abc', NaN])('an unknown score (%s) gives no result line', (bad) => {
    expect(matchupResultLine(m('final', bad, 109.7), 12)).toBeNull();
    expect(matchupResultLine(m('played', 109.7, bad), 12)).toBeNull();
    expect(matchupResultLine({ status: 'final', home: {}, away: {} }, 12)).toBeNull();
  });

  test('a nameless winner reads Home or Away, as the scoreboards do', () => {
    const nameless = { status: 'final', home: { score: 1 }, away: { score: 2 } };
    expect(matchupResultLine(nameless, null)).toBe('Away won by 1.0');
  });
});
