/* eslint-disable testing-library/no-node-access, testing-library/no-container -- the cursor frame, the pixel marks and the sticky strip are classes, svgs and styles with no role */
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import KickoffWindowGroup from './KickoffWindowGroup';

const view = (gameKey, overrides = {}) => ({
  gameKey,
  teams: gameKey.split('|'),
  kickoff: '2026-09-20T17:00:00Z',
  lock: false,
  phase: 'open',
  myPick: null,
  confidence: null,
  favorite: null,
  line: null,
  weather: null,
  venue: null,
  broadcast: null,
  records: null,
  situation: null,
  linescores: null,
  headline: null,
  winner: null,
  isTie: false,
  homeScore: null,
  awayScore: null,
  status: 'scheduled',
  quarter: null,
  timeRemaining: null,
  pickedCount: 0,
  reveal: null,
  outcome: null,
  lockMinutes: null,
  ...overrides,
});
const liveView = (gameKey, overrides = {}) => view(gameKey, {
  lock: true, phase: 'live', status: 'in_progress', quarter: 'Q4', timeRemaining: '4:21', homeScore: 20, awayScore: 17, ...overrides,
});
const finalView = (gameKey, overrides = {}) => view(gameKey, {
  lock: true, phase: 'final', status: 'final', winner: gameKey.split('|')[1], outcome: 'correct', myPick: gameKey.split('|')[1], ...overrides,
});

test('labels the window as a tertiary frame whose h3 names it, with one card per game', () => {
  render(<KickoffWindowGroup window="sunday-early" views={[view('NYJ|TEN'), view('DAL|WAS')]} mode="straight" totalManagers={10} />);
  expect(screen.getByRole('region', { name: 'Sunday Early' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 3, name: 'Sunday Early' })).toBeInTheDocument();
  expect(screen.getAllByTestId('game-card')).toHaveLength(2);
});

test('an unrecognized window key falls back to its own raw label', () => {
  render(<KickoffWindowGroup window="some-future-window" views={[]} mode="straight" totalManagers={10} />);
  expect(screen.getByText('some-future-window')).toBeInTheDocument();
});

test('the head says "League picks reveal at kickoff" once, however many cards', () => {
  render(<KickoffWindowGroup window="sunday-late" views={[view('A|B'), view('C|D'), view('E|F')]} mode="straight" totalManagers={10} />);
  expect(screen.getAllByText('League picks reveal at kickoff')).toHaveLength(1);
});

test('only the card passed as the cursor wears the frame', () => {
  const { container } = render(
    <KickoffWindowGroup window="sunday-late" views={[view('A|B'), view('C|D')]} mode="straight" totalManagers={10} cursorKey="C|D" cursorId="cur" />
  );
  const frames = container.querySelectorAll('.cursor');
  expect(frames).toHaveLength(1);
  expect(frames[0]).toContainElement(screen.getByRole('article', { name: 'C at D' }));
});

test('routes each card its own save state and the group\'s handlers', async () => {
  const user = userEvent.setup();
  const onUndo = jest.fn();
  render(
    <KickoffWindowGroup
      window="sunday-late"
      views={[view('A|B', { myPick: 'B' }), view('C|D')]}
      mode="straight"
      totalManagers={10}
      stateFor={(key) => (key === 'A|B' ? { status: 'saved' } : null)}
      onUndo={onUndo}
    />
  );
  expect(within(screen.getByRole('article', { name: 'A at B' })).getByRole('status')).toHaveTextContent('Pick saved');
  expect(within(screen.getByRole('article', { name: 'C at D' })).getByRole('status')).toHaveTextContent('');
  await user.click(screen.getByRole('button', { name: /Undo pick, A at B/ }));
  expect(onUndo).toHaveBeenCalledWith('A|B');
});

describe('a settled window', () => {
  test('is one summary row with a ghost Show games toggle, collapsed by default and expandable', async () => {
    const user = userEvent.setup();
    render(
      <KickoffWindowGroup
        window="sunday-early"
        views={[liveView('A|B', { myPick: 'A' }), liveView('C|D'), liveView('E|F', { myPick: 'F' })]}
        mode="straight"
        totalManagers={10}
      />
    );
    expect(screen.getByTestId('window-summary')).toHaveTextContent('3 live · 2 picked · 1 no pick');
    const toggle = screen.getByRole('button', { name: 'Show games, Sunday Early' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryAllByTestId('game-card')).toHaveLength(0);
    await user.click(toggle);
    expect(screen.getAllByTestId('game-card')).toHaveLength(3);
    const hide = screen.getByRole('button', { name: 'Hide games, Sunday Early' });
    expect(hide).toHaveAttribute('aria-expanded', 'true');
    expect(hide).toHaveAttribute('aria-controls', screen.getAllByRole('list')[0].id);
  });

  test('a final window reads "Final · {c} of {p} correct", with the no-pick count only when some game had none', () => {
    const { rerender } = render(
      <KickoffWindowGroup
        window="sunday-early"
        views={[finalView('A|B'), finalView('C|D', { outcome: 'missed', myPick: 'C' }), finalView('E|F', { myPick: null, outcome: 'no-pick' })]}
        mode="straight"
        totalManagers={10}
      />
    );
    expect(screen.getByTestId('window-summary')).toHaveTextContent('Final · 1 of 2 correct · 1 no pick');
    rerender(
      <KickoffWindowGroup window="sunday-early" views={[finalView('A|B'), finalView('C|D', { outcome: 'missed', myPick: 'C' })]} mode="straight" totalManagers={10} />
    );
    expect(screen.getByTestId('window-summary')).toHaveTextContent('Final · 1 of 2 correct');
    expect(screen.getByTestId('window-summary')).not.toHaveTextContent('no pick');
  });

  test('every pick right in two or more games earns the pixel star and the word Perfect; one game never does', () => {
    const { rerender } = render(
      <KickoffWindowGroup window="sunday-early" views={[finalView('A|B'), finalView('C|D')]} mode="straight" totalManagers={10} />
    );
    expect(screen.getByTestId('window-summary')).toHaveTextContent('Final · 2 of 2 correct');
    expect(within(screen.getByTestId('window-summary')).getByText('Perfect')).toBeInTheDocument();
    expect(screen.getByTestId('window-summary').querySelector('svg')).not.toBeNull();
    rerender(<KickoffWindowGroup window="thursday-night" views={[finalView('A|B')]} mode="straight" totalManagers={10} />);
    expect(screen.queryByText('Perfect')).not.toBeInTheDocument();
  });
});

describe('confidence hint', () => {
  test('one hint per head while an open game has no pick, and each disabled select points at it', () => {
    render(
      <KickoffWindowGroup window="sunday-late" views={[view('A|B'), view('C|D', { myPick: 'D', confidence: 3 })]} mode="confidence" totalManagers={10} slateSize={14} />
    );
    const hints = screen.getAllByText('Pick a team to set its confidence');
    expect(hints).toHaveLength(1);
    expect(within(screen.getByRole('article', { name: 'A at B' })).getByRole('combobox')).toHaveAttribute('aria-describedby', hints[0].id);
    expect(within(screen.getByRole('article', { name: 'C at D' })).getByRole('combobox')).not.toHaveAttribute('aria-describedby');
  });

  test('no hint once every open game has a pick, and none in straight-up mode', () => {
    const { rerender } = render(
      <KickoffWindowGroup window="sunday-late" views={[view('A|B', { myPick: 'B', confidence: 1 })]} mode="confidence" totalManagers={10} slateSize={14} />
    );
    expect(screen.queryByText('Pick a team to set its confidence')).not.toBeInTheDocument();
    rerender(<KickoffWindowGroup window="sunday-late" views={[view('A|B')]} mode="straight" totalManagers={10} />);
    expect(screen.queryByText('Pick a team to set its confidence')).not.toBeInTheDocument();
  });
});
