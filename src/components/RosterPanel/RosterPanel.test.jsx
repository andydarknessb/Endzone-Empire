import React from 'react';
import { render, screen, within } from '@testing-library/react';
import RosterPanel from './RosterPanel';

// Rendered with NO providers, exactly as the Draft Simulator does.
const STANDARD = [
  { key: 'QB', label: 'QB', count: 1, eligiblePositions: ['QB'] },
  { key: 'RB', label: 'RB', count: 2, eligiblePositions: ['RB'] },
  { key: 'WR', label: 'WR', count: 2, eligiblePositions: ['WR'] },
  { key: 'TE', label: 'TE', count: 1, eligiblePositions: ['TE'] },
  { key: 'FLEX', label: 'FLEX', count: 1, eligiblePositions: ['RB', 'WR', 'TE'] },
  { key: 'K', label: 'K', count: 1, eligiblePositions: ['K'] },
  { key: 'DEF', label: 'DEF', count: 1, eligiblePositions: ['DEF'] },
];

// The brief's real league: 12 starters, 7 bench, 1 IR, 20 total.
const LEAGUE_12 = [
  ...STANDARD,
  { key: 'D LINE', count: 1, eligiblePositions: ['DL'] },
  { key: 'LB', count: 1, eligiblePositions: ['LB'] },
  { key: 'DB', count: 1, eligiblePositions: ['DB'] },
];

const pick = (pickNumber, position, extra = {}) => ({
  pickNumber,
  pickLabel: `${Math.ceil(pickNumber / 10)}.${String(((pickNumber - 1) % 10) + 1).padStart(2, '0')}`,
  playerId: pickNumber,
  name: `Player ${pickNumber}`,
  position,
  nflTeam: 'HOU',
  ...extra,
});

const renderPanel = (props = {}) =>
  render(<RosterPanel rosterSlots={STANDARD} benchCount={6} irCount={0} picks={[]} {...props} />);

const slotLabels = (sectionLabel) =>
  within(screen.getByRole('list', { name: sectionLabel }))
    .getAllByRole('listitem')
    .map((li) => li.getAttribute('aria-label'));

describe('the empty roster (acceptance criterion 1)', () => {
  test('shows every starter slot plus six bench rows and no IR row', () => {
    renderPanel();
    expect(slotLabels('Starters')).toEqual([
      'QB slot, empty', 'RB 1 slot, empty', 'RB 2 slot, empty',
      'WR 1 slot, empty', 'WR 2 slot, empty', 'TE slot, empty',
      'FLEX slot, empty', 'K slot, empty', 'DEF slot, empty',
    ]);
    expect(slotLabels('Bench')).toHaveLength(6);
    expect(screen.queryByRole('list', { name: 'Injured reserve' })).not.toBeInTheDocument();
  });

  test('marks open rows with a word, not just a border colour', () => {
    renderPanel();
    expect(screen.getAllByText('Open')).toHaveLength(15);
  });

  test('shows eligible positions as helper text on multi-position slots only', () => {
    renderPanel();
    const flexRow = screen.getByLabelText('FLEX slot, empty');
    expect(within(flexRow).getByText('RB/WR/TE')).toBeInTheDocument();
    // A dedicated slot carries its label and nothing else, so "QB" appears once.
    const qbRow = screen.getByLabelText('QB slot, empty');
    expect(within(qbRow).getAllByText('QB')).toHaveLength(1);
  });

  test('renders nothing at all when a league has no slots configured', () => {
    const { container } = renderPanel({ rosterSlots: [] });
    expect(container).toBeEmptyDOMElement();
  });
});

describe('filled rows', () => {
  test('names the player, position, team and pick in the accessible name', () => {
    renderPanel({ picks: [pick(3, 'WR', { name: 'Nico Collins' })] });
    expect(screen.getByLabelText('WR 1 slot, Nico Collins, WR, HOU, pick 1.03')).toBeInTheDocument();
  });

  test('flags an autopick and a keeper without relying on colour', () => {
    renderPanel({
      picks: [pick(1, 'QB', { auto: true }), pick(2, 'RB', { keeper: true })],
    });
    expect(screen.getByText('Auto')).toBeInTheDocument();
    expect(screen.getByText('Keeper')).toBeInTheDocument();
    expect(screen.getByLabelText(/auto-drafted$/)).toBeInTheDocument();
    expect(screen.getByLabelText(/keeper$/)).toBeInTheDocument();
  });

  test('keeps open and filled rows the same height so nothing reflows', () => {
    renderPanel({ picks: [pick(1, 'QB')] });
    const rows = within(screen.getByRole('list', { name: 'Starters' })).getAllByRole('listitem');
    const heights = rows.map((row) => window.getComputedStyle(row).minHeight);
    expect(new Set(heights).size).toBe(1);
  });
});

describe('the bench-count and IR props (acceptance criterion 8)', () => {
  test('renders a 12 starter / 7 bench / 1 IR league without code changes', () => {
    renderPanel({ rosterSlots: LEAGUE_12, benchCount: 7, irCount: 1, rounds: 20 });
    expect(slotLabels('Starters')).toHaveLength(12);
    expect(slotLabels('Bench')).toHaveLength(7);
    expect(slotLabels('Injured reserve')).toEqual(['IR 1 slot, empty, injured reserve']);
  });

  test('a 12/7/1 league at 20 rounds shows no capacity note, because it balances', () => {
    renderPanel({ rosterSlots: LEAGUE_12, benchCount: 7, irCount: 1, rounds: 20 });
    expect(screen.queryByText(/rounds/)).not.toBeInTheDocument();
  });

  test('respects a different bench count', () => {
    renderPanel({ benchCount: 7 });
    expect(slotLabels('Bench')).toHaveLength(7);
  });
});

describe('the rounds-vs-capacity note', () => {
  test('says so when a draft runs longer than the roster can hold', () => {
    // The legacy shape the roster migration can leave behind: roster_limit was
    // never rewritten when bench_slots got clamped.
    renderPanel({ rounds: 25 });
    expect(screen.getByText(
      'This draft runs 25 rounds but only 15 of your spots are drafted '
      + '(9 starters, 6 bench, 0 IR). The last 10 picks have nowhere to go.'
    )).toBeInTheDocument();
  });

  test('uses the singular when exactly one pick is homeless', () => {
    renderPanel({ rounds: 16 });
    expect(screen.getByText(/The last pick has nowhere to go\.$/)).toBeInTheDocument();
  });

  test('says so in the other direction too', () => {
    renderPanel({ rounds: 13 });
    expect(screen.getByText(
      'This draft runs 13 rounds, 2 short of your 15 roster spots. '
      + "You'll finish with open spots to fill from waivers."
    )).toBeInTheDocument();
  });

  test.each([[15], [null], [undefined]])('stays silent when rounds is %s', (rounds) => {
    renderPanel({ rounds });
    expect(screen.queryByText(/This draft runs/)).not.toBeInTheDocument();
  });
});

describe('overflow', () => {
  test('surfaces a pick with nowhere to go instead of dropping it', () => {
    const picks = Array.from({ length: 16 }, (_, i) => pick(i + 1, 'RB'));
    renderPanel({ picks });
    expect(screen.getByRole('list', { name: 'No slot' })).toBeInTheDocument();
    expect(screen.getByText(/Past your roster spots/)).toBeInTheDocument();
  });
});

// These two lock in the constraints that keep the existing suites green.
// See src/components/DraftBoard/DraftBoard.test.jsx:720 and
// src/components/DraftSim/DraftSimulator.test.jsx:87.
describe('regression guards for the suites this component lands in', () => {
  test('never renders a status role, which DraftRail already owns', () => {
    renderPanel({ picks: [pick(1, 'QB')], rounds: 25 });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  test('never renders a pick as "#N", which DraftBoard.test.jsx queries for', () => {
    renderPanel({ picks: [pick(1, 'QB')] });
    expect(screen.queryByText('#1')).not.toBeInTheDocument();
  });

  test('renders player names as plain text, never as buttons', () => {
    renderPanel({ picks: [pick(1, 'QB', { name: 'Patrick Mahomes' })] });
    expect(screen.getByText('Patrick Mahomes')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  test('renders no bare number that could collide with another panel’s text', () => {
    renderPanel({ picks: [pick(1, 'QB')], rounds: 25 });
    const bare = [...document.querySelectorAll('*')]
      .filter((el) => el.children.length === 0 && /^\d+(\.\d+)?$/.test(el.textContent.trim()))
      .map((el) => el.textContent.trim());
    // The only bare numbers this panel emits are R.PP pick labels, which are
    // always zero-padded to two decimal places. That is what keeps them clear
    // of DraftBoard.test.jsx's getByText('21.5') / ('3.2') projection queries
    // and of its getByText('#1') pick reference.
    expect(bare.every((text) => /^\d+\.\d{2}$/.test(text))).toBe(true);
  });
});
