import React from 'react';
import { screen, within } from '@testing-library/react';
import renderWithProviders from '../../../test-utils/renderWithProviders';
import WaiverSummary from './WaiverSummary';

const NOW = new Date('2026-09-24T12:00:00Z');
const in_ = (ms) => new Date(NOW.getTime() + ms).toISOString();
const H = 3600 * 1000;

const base = {
  now: NOW,
  nextClear: null,
  pendingCount: 0,
  faab: null,
  waiverPriority: 7,
  roster: { count: 18, capacity: 20, atCapacity: false },
};

const renderStrip = (over) => renderWithProviders(<WaiverSummary {...base} {...over} />);

test('a per-player Clear time shows the countdown and names the player', () => {
  renderStrip({ nextClear: { at: in_(14 * H + 22 * 60000), kind: 'player', playerName: 'Tyjae Spears' } });
  const tile = screen.getByTestId('waiver-summary-next-clear');
  expect(within(tile).getByText('14h 22m')).toBeInTheDocument();
  expect(within(tile).getByText(/Tyjae Spears clears/)).toBeInTheDocument();
});

test('while the blanket clear time runs it says waivers clear, with no player', () => {
  renderStrip({ nextClear: { at: in_(3 * H), kind: 'blanket', playerName: null }, pendingCount: 2 });
  const tile = screen.getByTestId('waiver-summary-next-clear');
  expect(within(tile).getByText('3h 0m')).toBeInTheDocument();
  expect(within(tile).getByText(/Waivers clear/)).toBeInTheDocument();
});

test('no pending claims shows none', () => {
  renderStrip({});
  const tile = screen.getByTestId('waiver-summary-next-clear');
  expect(within(tile).getByText('None')).toBeInTheDocument();
  expect(within(tile).getByText('No pending claims')).toBeInTheDocument();
});

test('the copy never says claims process at a single time', () => {
  const { container } = renderStrip({ nextClear: { at: in_(H), kind: 'blanket', playerName: null } });
  expect(container.textContent).not.toMatch(/claims process at/i);
});

test('a FAAB league shows FAAB left after pending bids, with Waiver priority as the tiebreaker', () => {
  renderStrip({ faab: { committed: 24, left: 62 }, pendingCount: 3 });
  const faab = screen.getByTestId('waiver-summary-faab');
  expect(within(faab).getByText('$62')).toBeInTheDocument();
  expect(within(faab).getByText('$24 bid on 3 pending claims')).toBeInTheDocument();
  const priority = screen.getByTestId('waiver-summary-priority');
  expect(within(priority).getByText('#7')).toBeInTheDocument();
  expect(within(priority).getByText(/Breaks equal bids/)).toBeInTheDocument();
});

test('a priority league shows Waiver priority and no FAAB tile', () => {
  renderStrip({});
  expect(screen.queryByTestId('waiver-summary-faab')).not.toBeInTheDocument();
  expect(within(screen.getByTestId('waiver-summary-priority')).getByText('#7')).toBeInTheDocument();
});

test('a team with no Waiver priority yet reads TBD', () => {
  renderStrip({ waiverPriority: null });
  expect(within(screen.getByTestId('waiver-summary-priority')).getByText('TBD')).toBeInTheDocument();
});

test('the roster count flags a required drop at Roster capacity', () => {
  renderStrip({ roster: { count: 20, capacity: 20, atCapacity: true } });
  const roster = screen.getByTestId('waiver-summary-roster');
  expect(within(roster).getByText('20/20')).toBeInTheDocument();
  expect(within(roster).getByText('Full')).toBeInTheDocument();
  expect(within(roster).getByText('Every claim needs a drop.')).toBeInTheDocument();
});

test('under capacity there is no drop flag, and an unknown count hides the tile', () => {
  const { unmount } = renderStrip({});
  expect(screen.queryByText('Full')).not.toBeInTheDocument();
  expect(within(screen.getByTestId('waiver-summary-roster')).getByText('18/20')).toBeInTheDocument();
  unmount();
  renderStrip({ roster: null });
  expect(screen.queryByTestId('waiver-summary-roster')).not.toBeInTheDocument();
});
