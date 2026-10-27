import { nextLockAt } from './lineupNote';

const at = (minutes) => Date.now() + minutes * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();
const game = (over = {}) => ({
  tank01_game_id: 'g1', game_status: 'scheduled', home_team: 'ARI', away_team: 'SF', start_time: iso(at(30)), ...over,
});

describe('nextLockAt', () => {
  test('the Lineup problem deadline wins over an earlier kickoff', () => {
    const deadline = iso(at(240));
    const games = [game({ start_time: iso(at(60)) })];
    expect(nextLockAt(deadline, [{ nfl_team: 'SF' }], games)).toBe(new Date(deadline).getTime());
  });

  test('with no deadline the viewer\'s earliest unstarted kickoff wins while an opponent-only game kicks off earlier', () => {
    const viewerKickoff = at(120);
    const games = [
      game({ tank01_game_id: 'opponent', home_team: 'ARI', away_team: 'SF', start_time: iso(at(30)) }),
      game({ tank01_game_id: 'viewer', home_team: 'BUF', away_team: 'KC', start_time: iso(viewerKickoff) }),
    ];
    expect(nextLockAt(null, [{ nfl_team: 'KC' }], games)).toBe(viewerKickoff);
  });

  test('no viewer side gives null, never the opponent\'s kickoff', () => {
    const games = [game({ start_time: iso(at(30)) })];
    expect(nextLockAt(null, [], games)).toBeNull();
    expect(nextLockAt(undefined, undefined, games)).toBeNull();
  });
});
