import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { BenchWhatIf, SlotComparisonList, StickyScoreboard, LiveTicker } from './MatchupExtras';

const player = (overrides = {}) => ({
  id: 1,
  name: 'P. Mahomes',
  slot: 'QB',
  position: 'QB',
  nfl_team: 'KC',
  injury_status: null,
  points: 24.1,
  projected: 22,
  stats: { passingYards: 300, passingTDs: 3 },
  ...overrides,
});

describe('SlotComparisonList', () => {
  test('pairs home and away starters index-by-index into one row per slot', () => {
    const home = [player({ id: 1, name: 'P. Mahomes', slot: 'QB' }), player({ id: 2, name: 'C. McCaffrey', slot: 'RB' })];
    const away = [player({ id: 3, name: 'J. Allen', slot: 'QB' }), player({ id: 4, name: 'D. Henry', slot: 'RB' })];

    render(
      <SlotComparisonList
        homeStarters={home}
        awayStarters={away}
        expandedId={null}
        onToggle={jest.fn()}
        onOpenPlayer={jest.fn()}
      />
    );

    expect(screen.getAllByText('QB')).toHaveLength(1);
    expect(screen.getAllByText('RB')).toHaveLength(1);
    expect(screen.getByText('P. Mahomes')).toBeInTheDocument();
    expect(screen.getByText('J. Allen')).toBeInTheDocument();
    expect(screen.getByText('C. McCaffrey')).toBeInTheDocument();
    expect(screen.getByText('D. Henry')).toBeInTheDocument();
  });

  test('sorts starters into fantasy-standard slot order regardless of input order, and shows DEF as D/ST', () => {
    const home = [
      player({ id: 1, name: 'Def Guy', slot: 'DEF' }),
      player({ id: 2, name: 'Flex Guy', slot: 'FLEX' }),
      player({ id: 3, name: 'Kick Guy', slot: 'K' }),
      player({ id: 4, name: 'QB Guy', slot: 'QB' }),
      player({ id: 5, name: 'RB Guy', slot: 'RB' }),
      player({ id: 6, name: 'TE Guy', slot: 'TE' }),
      player({ id: 7, name: 'WR Guy', slot: 'WR' }),
    ];

    render(
      <SlotComparisonList
        homeStarters={home}
        awayStarters={[]}
        expandedId={null}
        onToggle={jest.fn()}
        onOpenPlayer={jest.fn()}
      />
    );

    const names = screen.getAllByText(/Guy$/).map((el) => el.textContent);
    expect(names).toEqual(['QB Guy', 'RB Guy', 'WR Guy', 'TE Guy', 'Flex Guy', 'Kick Guy', 'Def Guy']);
    expect(screen.getByText('D/ST')).toBeInTheDocument();
    expect(screen.queryByText('DEF')).not.toBeInTheDocument();
  });

  test('renders unpaired remainder rows with an empty opposite side when lengths differ', () => {
    const home = [player({ id: 1, name: 'P. Mahomes', slot: 'QB' }), player({ id: 2, name: 'Bench Extra', slot: 'FLEX' })];
    const away = [player({ id: 3, name: 'J. Allen', slot: 'QB' })];

    render(
      <SlotComparisonList
        homeStarters={home}
        awayStarters={away}
        expandedId={null}
        onToggle={jest.fn()}
        onOpenPlayer={jest.fn()}
      />
    );

    expect(screen.getByText('Bench Extra')).toBeInTheDocument();
    expect(screen.getByText('FLEX')).toBeInTheDocument();
    expect(screen.getByText('J. Allen')).toBeInTheDocument();
    // Row-side wrappers expose aria-expanded; PlayerNameLink's inner <button> doesn't,
    // so filtering on it isolates the clickable slot sides: 2 in the paired row, 1 in
    // the unpaired remainder row (its away side renders no interactive element at all).
    expect(screen.getAllByRole('button', { expanded: false })).toHaveLength(3);
  });

  test('tapping either side of a row expands that player stat line + pace bar independently', () => {
    const home = [player({ id: 1, name: 'P. Mahomes', slot: 'QB', stats: { passingYards: 300, passingTDs: 3 } })];
    const away = [player({ id: 2, name: 'J. Allen', slot: 'QB', stats: { rushingYards: 40, rushingTDs: 1 } })];
    const onToggle = jest.fn();

    const { rerender } = render(
      <SlotComparisonList
        homeStarters={home}
        awayStarters={away}
        expandedId={null}
        onToggle={onToggle}
        onOpenPlayer={jest.fn()}
      />
    );

    fireEvent.click(screen.getByText('P. Mahomes'));
    // PlayerNameLink click opens the quick view, not the row — the row toggle
    // is triggered by the surrounding button, so simulate that expansion directly.
    expect(onToggle).not.toHaveBeenCalled();

    const [homeSide] = screen.getAllByRole('button', { expanded: false });
    fireEvent.click(homeSide);
    expect(onToggle).toHaveBeenCalledWith(1);

    rerender(
      <SlotComparisonList
        homeStarters={home}
        awayStarters={away}
        expandedId={1}
        onToggle={onToggle}
        onOpenPlayer={jest.fn()}
      />
    );
    expect(screen.getByText(/pass yds/)).toBeInTheDocument();
    expect(screen.queryByText(/rush yds/)).not.toBeInTheDocument();

    rerender(
      <SlotComparisonList
        homeStarters={home}
        awayStarters={away}
        expandedId={2}
        onToggle={onToggle}
        onOpenPlayer={jest.fn()}
      />
    );
    expect(screen.getByText(/rush yds/)).toBeInTheDocument();
    expect(screen.queryByText(/pass yds/)).not.toBeInTheDocument();
  });

  test('is keyboard-operable via Enter/Space with aria-expanded', () => {
    const home = [player({ id: 1, name: 'P. Mahomes', slot: 'QB' })];
    const away = [player({ id: 2, name: 'J. Allen', slot: 'QB' })];
    const onToggle = jest.fn();

    render(
      <SlotComparisonList
        homeStarters={home}
        awayStarters={away}
        expandedId={null}
        onToggle={onToggle}
        onOpenPlayer={jest.fn()}
      />
    );

    const [homeButton] = screen.getAllByRole('button', { expanded: false });
    expect(homeButton).toHaveAttribute('aria-expanded', 'false');
    fireEvent.keyDown(homeButton, { key: 'Enter' });
    expect(onToggle).toHaveBeenCalledWith(1);
  });

  test('opening a player via PlayerNameLink calls onOpenPlayer without toggling the row', () => {
    const home = [player({ id: 1, name: 'P. Mahomes', slot: 'QB' })];
    const away = [player({ id: 2, name: 'J. Allen', slot: 'QB' })];
    const onToggle = jest.fn();
    const onOpenPlayer = jest.fn();

    render(
      <SlotComparisonList
        homeStarters={home}
        awayStarters={away}
        expandedId={null}
        onToggle={onToggle}
        onOpenPlayer={onOpenPlayer}
      />
    );

    fireEvent.click(screen.getByText('P. Mahomes'));
    expect(onOpenPlayer).toHaveBeenCalledWith(1);
    expect(onToggle).not.toHaveBeenCalled();
  });
});

describe('StickyScoreboard', () => {
  test('shows the combined score line and the LIVE/Final chip', () => {
    render(
      <StickyScoreboard
        homeName="Team A"
        awayName="Team B"
        homeScore={78.4}
        awayScore={65.2}
        homeProb={0.6}
        final={false}
        isLive
      />
    );
    expect(screen.getByText('Team A 78.4 - 65.2 Team B')).toBeInTheDocument();
    expect(screen.getByText('LIVE')).toBeInTheDocument();
  });

  test('shows a Final chip when the matchup is complete', () => {
    render(
      <StickyScoreboard
        homeName="Team A"
        awayName="Team B"
        homeScore={110}
        awayScore={90}
        homeProb={0.8}
        final
      />
    );
    expect(screen.getByText('Final')).toBeInTheDocument();
  });

  test('shows Not started without a win-probability bar before kickoff', () => {
    render(
      <StickyScoreboard
        homeName="Team A"
        awayName="Team B"
        homeScore={0}
        awayScore={0}
        homeProb={0.5}
        final={false}
        isLive={false}
      />
    );
    expect(screen.getByText('Not started')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Win probability:/i })).not.toBeInTheDocument();
  });
});

describe('LiveTicker', () => {
  const items = [
    { playerId: 1, name: 'J. Chase', side: 'home', pointsDelta: 9.9, type: 'TD' },
    { playerId: 2, name: 'S. Diggs', side: 'away', pointsDelta: 6.2, type: 'TD' },
  ];

  test('renders a static "Last:" line for the most recent play alongside the marquee', () => {
    render(<LiveTicker items={items} />);
    expect(screen.getByText(/^Last: S\. Diggs/)).toBeInTheDocument();
    // The marquee still renders both plays (duplicated for the seamless loop).
    expect(screen.getAllByText(/J\. Chase/).length).toBeGreaterThan(1);
  });
});

describe('BenchWhatIf', () => {
  // An already-optimal panel (no delta, no swaps) is enough to exercise both the
  // complete-copy path and the title's heading level.
  const renderOptimalPanel = () =>
    render(
      <BenchWhatIf
        whatIf={{ delta: 0, swaps: [] }}
        hasRoster
        open={false}
        onToggle={jest.fn()}
      />
    );

  test('uses complete copy when the active lineup is already optimal', () => {
    renderOptimalPanel();

    expect(screen.getByText('Your best legal lineup is already active.')).toBeInTheDocument();
    expect(screen.queryByText('Your best legal lineup is in')).not.toBeInTheDocument();
  });

  // The panel is rendered below MatchupDetail's h4 page title ("Week N Matchup"),
  // so its title must be h5, one level below, not the h3 #721 chose.
  test('titles the panel as a level-5 heading (below the h4 page title)', () => {
    renderOptimalPanel();

    expect(screen.getByRole('heading', { level: 5, name: 'Bench what-if' })).toBeInTheDocument();
  });
});
