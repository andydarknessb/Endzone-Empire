import {
  matchupFromListRow,
  matchupFromDetailBody,
  applyScoreEvent,
  applyIdentityPatch,
  matchupStatusView,
} from './matchupModel';

// A list row exactly as GET /api/league/:id/matchups delivers it
// (matchups.* joined to the two teams, then attachExpectedFinals decorated).
const listRow = {
  id: 5,
  season: 2025,
  week: 3,
  final: false,
  status: 'live',
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

describe('matchupStatusView: the one status predicate', () => {
  test.each([
    ['scheduled', 'Scheduled', false],
    ['live', 'LIVE', true],
    ['played', 'Awaiting final', true],
    ['final', 'Final', true],
  ])('status %s -> chip %s, hasStarted %s', (status, chipLabel, hasStarted) => {
    expect(matchupStatusView(status)).toEqual({ chipLabel, hasStarted });
  });

  test('an unknown status (null) renders no chip and asserts neither started nor not-started', () => {
    // ADR 0030: a status the server could not compute is stated as unknown, never
    // guessed. No chip (not a false "Scheduled"), and hasStarted is null, never
    // false, so a caller's not-started branch (hasStarted === false) stays shut.
    expect(matchupStatusView(null)).toEqual({ chipLabel: null, hasStarted: null });
    expect(matchupStatusView(undefined)).toEqual({ chipLabel: null, hasStarted: null });
  });
});
