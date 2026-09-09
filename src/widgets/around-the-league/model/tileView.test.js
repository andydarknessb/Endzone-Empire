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

  it('reads the score, and is neither started nor scheduled, on an unknown status', () => {
    // ADR 0030: an unknown status asserts neither state. `started` and
    // `scheduled` must BOTH read false here - a caller keying a label off
    // `!started` would wrongly treat this as scheduled and print "Projected"
    // over what is actually the score (a stored fact, matchup-grid's own
    // convention this tile matches).
    const view = aroundLeagueTileView(
      row({ status: 'not-a-real-status', home_score: '92.1', away_score: '88.7' })
    );
    expect(view.started).toBe(false);
    expect(view.scheduled).toBe(false);
    expect(view.home.figure).toBe('92.1');
    expect(view.away.figure).toBe('88.7');
  });

  it('exposes `scheduled` distinctly from `started`, for a caller to label the figure', () => {
    const scheduled = aroundLeagueTileView(row());
    expect(scheduled.scheduled).toBe(true);
    expect(scheduled.started).toBe(false);

    const started = aroundLeagueTileView(row({ status: 'live' }));
    expect(started.scheduled).toBe(false);
    expect(started.started).toBe(true);
  });

  it('renders a dash for a figure with no value to show', () => {
    const view = aroundLeagueTileView(
      row({ home_expected_final: null, away_expected_final: null })
    );
    expect(view.scheduled).toBe(true);
    expect(view.home.figure).toBe('-');
    expect(view.away.figure).toBe('-');
  });
});
