import { matchupFromListRow } from '../../../entities/matchup';
import { aroundLeagueTileView, formatPoints } from './tileView';

function row(overrides = {}) {
  return matchupFromListRow({
    id: 1,
    season: 2026,
    week: 3,
    final: false,
    status: 'scheduled',
    home_team_id: 1,
    home_team_name: 'Bemidji Blizzard',
    home_score: '0',
    home_expected_final: 108.3,
    home_players_remaining: 9,
    away_team_id: 2,
    away_team_name: 'Mankato Mavericks',
    away_score: '0',
    away_expected_final: 111.9,
    away_players_remaining: 9,
    ...overrides,
  });
}

describe('formatPoints', () => {
  it('renders one decimal', () => {
    expect(formatPoints('92.14')).toBe('92.1');
  });

  it('renders a dash for an unknown value', () => {
    expect(formatPoints(null)).toBe('-');
  });
});

describe('aroundLeagueTileView', () => {
  it('shows each side projected total before kickoff', () => {
    const view = aroundLeagueTileView(row());
    expect(view.started).toBe(false);
    expect(view.home.figure).toBe('108.3');
    expect(view.away.figure).toBe('111.9');
  });

  it('shows each side live score once the matchup has started', () => {
    const view = aroundLeagueTileView(
      row({ status: 'live', home_score: '92.1', away_score: '88.7' })
    );
    expect(view.started).toBe(true);
    expect(view.home.figure).toBe('92.1');
    expect(view.away.figure).toBe('88.7');
  });

  it('marks isViewer by Team id, never by home/away position', () => {
    // The viewer sits AWAY here. A home/away shortcut would ring the wrong
    // side (or nothing), which is the red-tell this fixture is built to
    // catch.
    const view = aroundLeagueTileView(row(), { viewerTeamId: 2 });
    expect(view.isViewer).toBe(true);
  });

  it('is not the viewer when neither side matches the viewer team id', () => {
    const view = aroundLeagueTileView(row(), { viewerTeamId: 999 });
    expect(view.isViewer).toBe(false);
  });

  it('computes a win probability split even before kickoff, from projections alone', () => {
    const view = aroundLeagueTileView(row());
    expect(view.homeShare).toBeGreaterThan(0);
    expect(view.homeShare).toBeLessThan(1);
  });
});
