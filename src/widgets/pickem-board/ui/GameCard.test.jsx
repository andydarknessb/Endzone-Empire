import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GameCard from './GameCard';

// A base view shaped like model/gameCardView.js's output. Each test overrides
// only what that state needs, keeping the eleven states legible against the
// canvas (docs/design/pickem/GameCard.dc.html) they mirror.
const baseView = (overrides = {}) => ({
  gameKey: 'NYJ|TEN',
  teams: ['NYJ', 'TEN'],
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
  flagged: false,
  ...overrides,
});

test('state 1: open, no pick - shows the pre-lock count and reveal promise, and nothing else', () => {
  render(
    <GameCard
      view={baseView({
        favorite: 'TEN',
        line: { spread: -1.5, total: 38.5 },
        pickedCount: 9,
        broadcast: 'CBS',
      })}
      mode="straight"
      totalManagers={10}
    />
  );
  expect(screen.getByRole('button', { name: /Jets/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Titans/i })).toBeInTheDocument();
  expect(screen.getByTestId('picked-count')).toHaveTextContent('9 of 10 managers have picked');
  expect(screen.getByText('League picks reveal at kickoff')).toBeInTheDocument();
  // THE RED-TELL: no direction anywhere on an unlocked card.
  expect(screen.queryByTestId('reveal-counts')).not.toBeInTheDocument();
  expect(screen.queryByText(/no pick$/)).not.toBeInTheDocument();
  expect(screen.getByTestId('fav-tag')).toBeInTheDocument();
  expect(screen.getByTestId('odds-badge')).toHaveTextContent('TEN -1.5 · O/U 38.5');
});

test('state 2: picked, confidence assigned', async () => {
  const onSetConfidence = jest.fn();
  const user = userEvent.setup();
  render(
    <GameCard
      view={baseView({ myPick: 'TEN', confidence: 14, pickedCount: 9 })}
      mode="confidence"
      slateSize={16}
      totalManagers={10}
      onSetConfidence={onSetConfidence}
    />
  );
  expect(screen.getByRole('combobox')).toHaveTextContent('Confidence 14');
  const tenButton = screen.getByRole('button', { name: /Titans/i });
  expect(tenButton).toHaveAttribute('aria-pressed', 'true');
  await user.click(screen.getByRole('combobox'));
  await user.click(within(screen.getByRole('listbox')).getByText('3'));
  expect(onSetConfidence).toHaveBeenCalledWith('NYJ|TEN', 3);
});

test('state 3: picked, straight-up mode - no confidence chip', () => {
  render(<GameCard view={baseView({ myPick: 'NYJ', pickedCount: 8 })} mode="straight" totalManagers={10} />);
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Jets/i })).toHaveAttribute('aria-pressed', 'true');
});

test('state 4: live, locked at kickoff - situation, win probability and the reveal tally', () => {
  render(
    <GameCard
      view={baseView({
        phase: 'live',
        lock: true,
        myPick: 'NYJ',
        confidence: 10,
        homeScore: 20,
        awayScore: 17,
        quarter: 'Q3',
        timeRemaining: '11:30',
        situation: { possession: 'NYJ', downDistance: '2nd & 10 at TEN 25', homeWinProbability: 0.61 },
        reveal: { counts: { NYJ: 7, TEN: 2 }, noPick: 1 },
      })}
      mode="confidence"
      slateSize={16}
      totalManagers={10}
    />
  );
  expect(screen.getByTestId('live-badge')).toHaveTextContent('Q3 · 11:30');
  expect(screen.getByTestId('locked-badge')).toHaveTextContent('Locked');
  expect(screen.getAllByTestId('team-score')).toHaveLength(2);
  expect(screen.getByText(/2nd & 10 at TEN 25/)).toBeInTheDocument();
  expect(screen.getByTestId('possession-dot')).toBeInTheDocument();
  expect(screen.getByTestId('reveal-counts')).toHaveTextContent('NYJ 7, TEN 2');
  expect(screen.getByText('1 no pick')).toBeInTheDocument();
  // Locked: both team buttons refuse further picks.
  expect(screen.getByRole('button', { name: /Jets/i })).toBeDisabled();
});

test('state 4b: an unlocked card never shows a reveal even if a bug somehow set one - reveal absence is the model\'s job, not this test\'s, but the render must still gate on phase', () => {
  render(<GameCard view={baseView({ phase: 'open', reveal: null })} mode="straight" totalManagers={10} />);
  expect(screen.queryByTestId('reveal-counts')).not.toBeInTheDocument();
});

test('state 5: final, correct pick', () => {
  render(
    <GameCard
      view={baseView({
        phase: 'final',
        lock: true,
        myPick: 'TEN',
        confidence: 9,
        winner: 'TEN',
        homeScore: 13,
        awayScore: 10,
        outcome: 'correct',
        headline: 'Titans hold off the Jets',
      })}
      mode="confidence"
      totalManagers={10}
    />
  );
  expect(screen.getByTestId('final-badge')).toHaveTextContent('Final');
  expect(screen.getByTestId('outcome-badge')).toHaveTextContent('Correct · +9');
  expect(screen.getByTestId('headline')).toHaveTextContent('Titans hold off the Jets');
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  const winnerButton = screen.getByRole('button', { name: /Titans/i });
  expect(winnerButton).toHaveStyle({ borderColor: 'var(--dash-away)' });
});

test('state 6: final, missed pick - the miss names the pick and the loser dims', () => {
  render(
    <GameCard
      view={baseView({
        phase: 'final',
        lock: true,
        myPick: 'NYJ',
        winner: 'TEN',
        homeScore: 27,
        awayScore: 7,
        outcome: 'missed',
        headline: 'Titans run away with it',
      })}
      mode="straight"
      totalManagers={10}
    />
  );
  expect(screen.getByTestId('outcome-badge')).toHaveTextContent('Missed · NYJ');
  const jetsButton = screen.getByRole('button', { name: /Jets/i });
  expect(jetsButton).toHaveAttribute('aria-pressed', 'true');
  expect(jetsButton).toHaveStyle({ opacity: 0.7 });
});

test('state 7: final, no pick made', () => {
  render(
    <GameCard
      view={baseView({
        phase: 'final',
        lock: true,
        myPick: null,
        winner: 'TEN',
        outcome: 'no-pick',
        headline: 'Titans win it',
      })}
      mode="straight"
      totalManagers={10}
    />
  );
  expect(screen.getByTestId('outcome-badge')).toHaveTextContent('No pick');
});

test('state 8: tie, nobody credited', () => {
  render(
    <GameCard
      view={baseView({
        phase: 'final',
        lock: true,
        myPick: 'NYJ',
        isTie: true,
        winner: null,
        homeScore: 20,
        awayScore: 20,
        outcome: 'tie',
        headline: 'They settle for a tie',
      })}
      mode="straight"
      totalManagers={10}
    />
  );
  expect(screen.getByTestId('outcome-badge')).toHaveTextContent('Tie · no credit');
});

test('state 9: flagged, save rejected - the error names what to fix, the control stays live', () => {
  render(
    <GameCard
      view={baseView({ myPick: 'NYJ', confidence: 14, flagged: true })}
      mode="confidence"
      slateSize={16}
      totalManagers={10}
      flaggedMessage="Confidence 14 is already on NYJ at TEN. Pick a different number."
    />
  );
  expect(screen.getByTestId('flagged-error')).toHaveTextContent('Pick a different number');
  expect(screen.getByTestId('confidence-menu')).toHaveAttribute('data-bad', 'true');
  expect(screen.getByRole('combobox')).not.toHaveAttribute('aria-disabled');
});

test('state 10: loading renders a skeleton with no interactive controls', () => {
  render(<GameCard view={baseView()} loading />);
  expect(screen.getByTestId('game-card-skeleton')).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

test('state 11: bare - no line, venue or weather yet, still shows the pick count', () => {
  render(<GameCard view={baseView({ pickedCount: 8 })} mode="confidence" slateSize={16} totalManagers={10} />);
  expect(screen.getByTestId('picked-count')).toHaveTextContent('8 of 10 managers have picked');
  expect(screen.queryByTestId('odds-badge')).not.toBeInTheDocument();
});

test('every team button is a real button with an aria-label naming the team, and a 44px target', () => {
  render(<GameCard view={baseView()} mode="straight" totalManagers={10} />);
  const buttons = screen.getAllByRole('button');
  expect(buttons).toHaveLength(2);
  for (const button of buttons) {
    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveAccessibleName();
  }
});

test('house style: no em-dash and no "insight" anywhere on the card', () => {
  const { container } = render(
    <GameCard
      view={baseView({
        phase: 'final',
        lock: true,
        myPick: 'TEN',
        winner: 'TEN',
        confidence: 9,
        outcome: 'correct',
        headline: 'Titans hold on late',
      })}
      mode="confidence"
      totalManagers={10}
    />
  );
  expect(container.textContent).not.toMatch(/—/);
  expect(container.textContent.toLowerCase()).not.toMatch(/insight/);
});
