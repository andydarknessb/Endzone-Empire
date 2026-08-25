import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PickHistory from './PickHistory';

// Issue #123 acceptance criterion 5. Pick history is the chronological view of
// the committed Picks the Draft board already holds (CONTEXT.md: Draft board),
// so it lives inside Board and is built from the same array the matrix is.
// PickHistory is provider-free (plain MUI plus PlayerNameLink).

// Deliberately handed over newest-first, the order useDraftSocket's reducer
// keeps them in.
const PICKS = [
  { pick_number: 3, player_id: 30, name: 'Iron Elk Pick', position: 'WR', nfl_team: 'DET', teamId: 1, teamName: 'Ridge Runners' },
  { pick_number: 2, player_id: 20, name: 'Justin Jefferson', position: 'WR', nfl_team: 'MIN', teamId: 2, teamName: 'Harbor Hawks', auto: true },
  { pick_number: 1, player_id: 10, name: 'Bijan Robinson', position: 'RB', nfl_team: 'ATL', teamId: 1, teamName: 'Ridge Runners' },
];

const baseProps = { picks: PICKS, onOpenQuickView: jest.fn(), slotTags: null };

const openHistory = async () => {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Pick history' }));
};

test('is collapsible: collapsed by default, and its trigger is a real H2', () => {
  render(<PickHistory {...baseProps} />);

  const trigger = screen.getByRole('button', { name: 'Pick history' });
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByRole('heading', { level: 2, name: 'Pick history' })).toBeInTheDocument();
});

test('opens on demand and exposes exactly one named region, not a nested duplicate', async () => {
  render(<PickHistory {...baseProps} />);
  await openHistory();

  // MUI's Accordion builds its own role="region" from the id on the FIRST
  // child it is handed (the <h2> wrapping AccordionSummary). A second one
  // added here would nest two identically named regions.
  expect(screen.getAllByRole('region', { name: 'Pick history' })).toHaveLength(1);
});

test('reads chronologically, oldest Pick first, whatever order it was handed', async () => {
  render(<PickHistory {...baseProps} />);
  await openHistory();

  const entries = screen.getAllByTestId('pick-history-entry');
  expect(entries.map((entry) => entry.getAttribute('data-pick-number'))).toEqual(['1', '2', '3']);
});

test('does not reorder the array it was given', async () => {
  const picks = [...PICKS];
  render(<PickHistory {...baseProps} picks={picks} />);
  await openHistory();

  expect(picks.map((pick) => pick.pick_number)).toEqual([3, 2, 1]);
});

test('attributes every Pick to a Team, and marks the ones autopick made', async () => {
  render(<PickHistory {...baseProps} />);
  await openHistory();

  const second = screen.getAllByTestId('pick-history-entry')[1];
  expect(within(second).getByText('Justin Jefferson')).toBeInTheDocument();
  expect(within(second).getByText(/by Harbor Hawks/)).toBeInTheDocument();
  expect(within(second).getByText(/AUTO/)).toBeInTheDocument();
});

test('a Pick with no Team identity reads as a former manager, never blank', async () => {
  render(<PickHistory {...baseProps} picks={[{ ...PICKS[2], teamName: null }]} />);
  await openHistory();

  expect(screen.getByText(/by Former manager/)).toBeInTheDocument();
});

test('tags the viewer\'s own Picks with the roster slot they filled', async () => {
  const slotTags = new Map([[1, { slotLabel: 'RB1' }]]);
  render(<PickHistory {...baseProps} slotTags={slotTags} />);
  await openHistory();

  const first = screen.getAllByTestId('pick-history-entry')[0];
  expect(within(first).getByText(/RB1/)).toBeInTheDocument();
  // Another Team's Pick has no slot on this viewer's roster to fill.
  expect(within(screen.getAllByTestId('pick-history-entry')[1]).queryByText(/RB1/)).not.toBeInTheDocument();
});

test('a player name opens Quick View rather than navigating away', async () => {
  const onOpenQuickView = jest.fn();
  render(<PickHistory {...baseProps} onOpenQuickView={onOpenQuickView} />);
  await openHistory();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Bijan Robinson' }));

  expect(onOpenQuickView).toHaveBeenCalledWith(10);
});

test('an empty history says so rather than rendering an empty box', async () => {
  render(<PickHistory {...baseProps} picks={[]} />);
  await openHistory();

  expect(screen.getByText('No picks yet')).toBeInTheDocument();
});

test('a caller can open it by default - a completed draft is its record', () => {
  render(<PickHistory {...baseProps} defaultExpanded />);

  expect(screen.getByRole('button', { name: 'Pick history' })).toHaveAttribute('aria-expanded', 'true');
});
