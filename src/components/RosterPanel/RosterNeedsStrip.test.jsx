import React from 'react';
import { render, screen } from '@testing-library/react';
import RosterNeedsStrip from './RosterNeedsStrip';

const STANDARD = [
  { key: 'QB', label: 'QB', count: 1, eligiblePositions: ['QB'] },
  { key: 'RB', label: 'RB', count: 2, eligiblePositions: ['RB'] },
  { key: 'WR', label: 'WR', count: 2, eligiblePositions: ['WR'] },
  { key: 'TE', label: 'TE', count: 1, eligiblePositions: ['TE'] },
  { key: 'FLEX', label: 'FLEX', count: 1, eligiblePositions: ['RB', 'WR', 'TE'] },
  { key: 'K', label: 'K', count: 1, eligiblePositions: ['K'] },
  { key: 'DEF', label: 'DEF', count: 1, eligiblePositions: ['DEF'] },
];

const pick = (pickNumber, position) => ({
  pickNumber, playerId: pickNumber, name: `Player ${pickNumber}`, position, nflTeam: 'HOU',
});

const renderStrip = (props = {}) =>
  render(<RosterNeedsStrip rosterSlots={STANDARD} benchCount={6} picks={[]} {...props} />);

describe('counts', () => {
  test('reads zero filled before a pick is made', () => {
    renderStrip();
    expect(screen.getByText('0 of 9 starters filled')).toBeInTheDocument();
    expect(screen.getByText('0 of 6 bench filled')).toBeInTheDocument();
  });

  test('tracks starters and bench as picks land', () => {
    // Three RBs: two start, the third takes FLEX. A fourth goes to the bench.
    renderStrip({ picks: [1, 2, 3, 4].map((n) => pick(n, 'RB')) });
    expect(screen.getByText('3 of 9 starters filled')).toBeInTheDocument();
    expect(screen.getByText('1 of 6 bench filled')).toBeInTheDocument();
  });
});

describe('need chips', () => {
  test('lists exactly the unfilled starting slots, pluralised by count', () => {
    renderStrip({ picks: [pick(1, 'QB'), pick(2, 'RB')] });
    expect(screen.getByText('RB')).toBeInTheDocument();      // one of two left
    expect(screen.getByText('WR ×2')).toBeInTheDocument();
    expect(screen.getByText('TE')).toBeInTheDocument();
    expect(screen.queryByText('QB')).not.toBeInTheDocument(); // filled, so not needed
  });

  test('collapses to "+N more" when the container is narrow', () => {
    renderStrip({ maxChips: 4 });
    // Seven slot kinds are unfilled; four are shown.
    expect(screen.getByText('+3 more')).toBeInTheDocument();
    expect(screen.queryByText('DEF')).not.toBeInTheDocument();
  });

  test('shows them all when there is room', () => {
    renderStrip({ maxChips: 10 });
    expect(screen.queryByText(/more$/)).not.toBeInTheDocument();
    expect(screen.getByText('DEF')).toBeInTheDocument();
  });

  test('drops the strip of chips entirely once the lineup is complete', () => {
    const picks = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'RB', 'K', 'DEF']
      .map((position, i) => pick(i + 1, position));
    renderStrip({ picks });
    expect(screen.getByText('9 of 9 starters filled')).toBeInTheDocument();
    expect(screen.queryByText('Need')).not.toBeInTheDocument();
  });
});

describe('the next pick', () => {
  test('shows the pick number when the draft order is known', () => {
    renderStrip({ nextPickLabel: '4.04' });
    expect(screen.getByText('Next pick 4.04')).toBeInTheDocument();
  });

  test('omits it rather than fabricating one before the order is set', () => {
    renderStrip({ nextPickLabel: null });
    expect(screen.queryByText(/Next pick/)).not.toBeInTheDocument();
  });
});

describe('the short-on-starters warning', () => {
  // Nine starting slots, all open, so `openStarters` is 9 throughout.
  test('stays quiet while there are more picks than open slots', () => {
    renderStrip({ remainingPicks: 10 });
    expect(screen.queryByText(/remaining pick/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Only/)).not.toBeInTheDocument();
  });

  test('warns at exactly enough picks', () => {
    renderStrip({ remainingPicks: 9 });
    expect(screen.getByText('Every remaining pick has to fill a starting spot.')).toBeInTheDocument();
  });

  test('escalates once the roster cannot be completed', () => {
    renderStrip({ remainingPicks: 6 });
    expect(screen.getByText('Only 6 picks left for 9 open starting spots.')).toBeInTheDocument();
  });

  test('uses the singular on the last pick', () => {
    const picks = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'RB', 'K']
      .map((position, i) => pick(i + 1, position));
    renderStrip({ picks, remainingPicks: 0 });
    expect(screen.getByText('Only 0 picks left for 1 open starting spot.')).toBeInTheDocument();
  });

  test('says nothing when remaining picks are unknown', () => {
    renderStrip({ remainingPicks: null });
    expect(screen.queryByText(/starting spot/)).not.toBeInTheDocument();
  });

  test('says nothing once every starting slot is filled, however few picks remain', () => {
    const picks = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'RB', 'K', 'DEF']
      .map((position, i) => pick(i + 1, position));
    renderStrip({ picks, remainingPicks: 0 });
    expect(screen.queryByText(/starting spot/)).not.toBeInTheDocument();
  });
});

describe('accessibility and regression guards', () => {
  test('announces politely without claiming the status role DraftRail owns', () => {
    renderStrip({ picks: [pick(1, 'QB')] });
    const region = screen.getByLabelText('Roster needs');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  test('renders nothing when a league has no slots configured', () => {
    const { container } = renderStrip({ rosterSlots: [] });
    expect(container).toBeEmptyDOMElement();
  });

  test('never renders a bare number as its own element', () => {
    renderStrip({ remainingPicks: 3, nextPickLabel: '4.04' });
    // Anything a reader would see as nothing but a number. getByText matches
    // on an element's whole text, so this covers the leaf elements the old
    // querySelectorAll('*') sweep walked, and any wrapper around one.
    expect(screen.queryAllByText(/^\d+(\.\d+)?$/)).toEqual([]);
  });
});
