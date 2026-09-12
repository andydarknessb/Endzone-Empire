import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StartSitPanel from './StartSitPanel';

const entries = [
  { playerId: 1, position: 'RB', kickoff: '2026-09-14T17:00:00Z' },
  { playerId: 2, position: 'RB', kickoff: '2026-09-14T20:00:00Z' },
];

const suggestion = (over = {}) => ({
  slot: 'RB',
  gain: 6.5,
  verdict: 'start',
  current: {
    playerId: 1, name: 'Sit Guy', projection: 8, opponent: 'CIN', opponentPointsAllowed: 12.1,
    distribution: { p10: 3, p90: 13 },
  },
  suggested: {
    playerId: 2, name: 'Start Guy', projection: 14.5, opponent: 'NYJ', opponentPointsAllowed: 21.4,
    distribution: { p10: 9, p90: 20 },
  },
  ...over,
});

test('hidden outright in best ball', () => {
  render(<StartSitPanel advice={{ suggestions: [suggestion()], movePlan: [] }} entries={entries} bestBall />);
  expect(screen.queryByTestId('start-sit-panel')).not.toBeInTheDocument();
});

test('renders a suggestion with both players\' Floor/Ceiling range bars, the opponent context and both kickoffs', () => {
  render(<StartSitPanel advice={{ suggestions: [suggestion()], movePlan: [] }} entries={entries} bestBall={false} />);
  const card = screen.getByTestId('suggestion-card');
  expect(within(card).getByText('Sit Guy')).toBeInTheDocument();
  expect(within(card).getByText('Start Guy')).toBeInTheDocument();
  expect(within(card).getAllByTestId('suggestion-range-bar')).toHaveLength(2);
  const context = within(card).getByTestId('suggestion-opponent-context');
  expect(context).toHaveTextContent('vs CIN (allows 12.1 to RB)');
  expect(context).toHaveTextContent('vs NYJ (allows 21.4 to RB)');
  expect(within(card).getByTestId('suggestion-decide-by')).toBeInTheDocument();
});

test('a tossup verdict shows the too-close-to-call chip, never a lean', () => {
  render(<StartSitPanel advice={{ suggestions: [suggestion({ verdict: 'tossup' })], movePlan: [] }} entries={entries} bestBall={false} />);
  const chip = screen.getByTestId('suggestion-verdict');
  expect(chip).toHaveTextContent('Too close to call');
  expect(chip).toHaveAttribute('data-verdict', 'tossup');
});

test('dismiss hides the suggestion without touching any other', async () => {
  const user = userEvent.setup();
  const second = suggestion({
    slot: 'WR',
    current: { ...suggestion().current, playerId: 3, name: 'Other Sit' },
    suggested: { ...suggestion().suggested, playerId: 4, name: 'Other Start' },
  });
  render(<StartSitPanel advice={{ suggestions: [suggestion(), second], movePlan: [] }} entries={entries} bestBall={false} />);
  expect(screen.getAllByTestId('suggestion-card')).toHaveLength(2);

  await user.click(within(screen.getAllByTestId('suggestion-card')[0]).getByTestId('suggestion-dismiss'));

  expect(screen.getAllByTestId('suggestion-card')).toHaveLength(1);
  expect(screen.getByText('Other Sit')).toBeInTheDocument();
});

test('compare is a no-op affordance: it renders but calls only its own callback', async () => {
  const user = userEvent.setup();
  const onCompare = jest.fn();
  render(<StartSitPanel advice={{ suggestions: [suggestion()], movePlan: [] }} entries={entries} bestBall={false} onCompare={onCompare} />);
  await user.click(screen.getByTestId('suggestion-compare'));
  expect(onCompare).toHaveBeenCalledTimes(1);
});

test('Apply sends the advice move plan through onApply', async () => {
  const user = userEvent.setup();
  const onApply = jest.fn();
  const movePlan = [{ playerId: 1, fromSlot: 'RB', toSlot: 'BENCH' }, { playerId: 2, fromSlot: 'BENCH', toSlot: 'RB' }];
  render(<StartSitPanel advice={{ suggestions: [suggestion()], movePlan }} entries={entries} bestBall={false} onApply={onApply} />);
  await user.click(screen.getByTestId('start-sit-apply'));
  expect(onApply).toHaveBeenCalledWith(movePlan);
});

test('no suggestions and no move plan shows "Lineup set" and no Apply button', () => {
  render(<StartSitPanel advice={{ suggestions: [], movePlan: [] }} entries={entries} bestBall={false} />);
  expect(screen.getByTestId('start-sit-panel-empty')).toHaveTextContent('Lineup set');
  expect(screen.queryByTestId('start-sit-apply')).not.toBeInTheDocument();
});

test('no "optimal", "optimize" or "range" copy anywhere on the panel', () => {
  const { container } = render(<StartSitPanel advice={{ suggestions: [suggestion()], movePlan: [{ playerId: 1, toSlot: 'RB' }] }} entries={entries} bestBall={false} />);
  const text = container.textContent;
  expect(text).not.toMatch(/optimal|optimize/i);
  expect(text).not.toMatch(/\brange\b/i);
});
