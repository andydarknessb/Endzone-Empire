/* eslint-disable testing-library/no-node-access, testing-library/no-container -- the cursor frame, the pixel marks and the sticky strip are classes, svgs and styles with no role */
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GameCard from './GameCard';

// A base view shaped like model/gameCardView.js's output. Each test overrides only what that state
// needs, keeping the states legible against docs/design/league/Pickem*.dc.html.
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
  lockMinutes: null,
  ...overrides,
});
const button = (team) => screen.getByRole('button', { name: (n) => n.startsWith(`${team},`) });

test('state 1: open, no pick - the pre-lock count, the odds badge, and no direction anywhere (the red-tell)', () => {
  render(
    <GameCard
      view={baseView({
        favorite: 'TEN', line: { spread: -1.5, total: 38.5 }, pickedCount: 9, broadcast: 'CBS',
      })}
      totalManagers={10}
    />
  );
  expect(screen.getByTestId('picked-count')).toHaveTextContent('9 of 10 managers have picked');
  // The reveal promise is once per window head now, not on the card.
  expect(screen.queryByText('League picks reveal at kickoff')).not.toBeInTheDocument();
  expect(screen.queryByTestId('reveal-counts')).not.toBeInTheDocument();
  expect(screen.queryByText(/no pick$/)).not.toBeInTheDocument();
  expect(screen.getByTestId('fav-tag')).toBeInTheDocument();
  expect(screen.getByTestId('odds-badge')).toHaveTextContent('TEN -1.5 · O/U 38.5');
  expect(button('NYJ')).toHaveAttribute('aria-pressed', 'false');
});

test('state 2: picked and saved - aria-pressed, the check and the word Pick, and the save line is empty at rest', () => {
  render(<GameCard view={baseView({ myPick: 'TEN', pickedCount: 9 })} totalManagers={10} />);
  expect(button('TEN')).toHaveAttribute('aria-pressed', 'true');
  expect(within(screen.getByTestId('game-card')).getByRole('status')).toHaveTextContent('');
});

test('urgency is words: under an hour the kickoff line and the names say "Locks in n min", picked or not', () => {
  const { rerender } = render(<GameCard view={baseView({ lockMinutes: 45 })} />);
  expect(screen.getByTestId('locks-in')).toHaveTextContent('Locks in 45 min');
  expect(screen.getByRole('article', { name: 'NYJ at TEN, locks in 45 min' })).toBeInTheDocument();
  expect(button('TEN')).toHaveAccessibleName(expect.stringMatching(/, locks in 45 min$/));
  rerender(<GameCard view={baseView({ lockMinutes: 45, myPick: 'TEN' })} />);
  expect(screen.getByTestId('locks-in')).toBeInTheDocument();
  rerender(<GameCard view={baseView({ lockMinutes: null })} />);
  expect(screen.queryByTestId('locks-in')).not.toBeInTheDocument();
  expect(screen.getByRole('article', { name: 'NYJ at TEN' })).toBeInTheDocument();
});

test('the cursor is a 4px frame on the card that is passed `cursor`, Danger under an hour, and the id the next-lock link targets', () => {
  const { container, rerender } = render(<GameCard view={baseView({ lockMinutes: 45 })} cursor cursorId="pickem-cursor" />);
  const frame = container.querySelector('.cursor');
  expect(frame).toHaveAttribute('id', 'pickem-cursor');
  expect(frame).toHaveAttribute('tabindex', '-1');
  expect(frame).toHaveStyle({ border: '4px solid var(--ps-danger)' });
  expect(screen.getByText('Next pick')).toBeInTheDocument();
  rerender(<GameCard view={baseView()} cursor cursorId="pickem-cursor" />);
  expect(container.querySelector('.cursor')).toHaveStyle({ border: '4px solid var(--ps-cursor)' });
  rerender(<GameCard view={baseView()} />);
  expect(container.querySelector('.cursor')).toBeNull();
  expect(screen.queryByText('Next pick')).not.toBeInTheDocument();
});

describe('the save line', () => {
  test('saving: the words are Dim, the chosen team is outlined not filled', () => {
    render(<GameCard view={baseView()} saveState={{ status: 'saving', attempted: { pickedTeam: 'TEN' } }} />);
    expect(screen.getByRole('status')).toHaveTextContent('Saving…');
    expect(button('TEN')).toHaveAttribute('data-attempt', 'true');
    expect(button('TEN')).toHaveAttribute('aria-pressed', 'false');
  });

  test('saved: Pick saved, and an Undo outside the live region that reports the card', async () => {
    const user = userEvent.setup();
    const onUndo = jest.fn();
    render(<GameCard view={baseView({ myPick: 'TEN' })} saveState={{ status: 'saved' }} onUndo={onUndo} />);
    expect(screen.getByRole('status')).toHaveTextContent('Pick saved');
    const undo = screen.getByRole('button', { name: 'Undo pick, NYJ at TEN' });
    expect(screen.getByRole('status')).not.toContainElement(undo);
    await user.click(undo);
    expect(onUndo).toHaveBeenCalledWith('NYJ|TEN');
  });

  test('a swap says who it swapped with and offers Undo swap', () => {
    render(<GameCard view={baseView({ myPick: 'TEN', confidence: 4 })} mode="confidence" slateSize={14} saveState={{ status: 'saved', swap: 'DAL @ DEN' }} />);
    expect(screen.getByRole('status')).toHaveTextContent('Swapped with DAL @ DEN');
    expect(screen.getByRole('status')).toHaveTextContent('Both ranks saved');
    expect(screen.getByRole('button', { name: 'Undo swap, NYJ at TEN' })).toBeInTheDocument();
  });

  test('failed: the Danger alert words with a Retry, a 2px Danger edge, the attempted team outlined', async () => {
    const user = userEvent.setup();
    const onRetry = jest.fn();
    const { container } = render(
      <GameCard
        view={baseView()}
        cursor
        cursorId="pickem-cursor"
        saveState={{ status: 'failed', attempted: { pickedTeam: 'TEN' }, message: "Couldn't save this pick." }}
        onRetry={onRetry}
      />
    );
    expect(screen.getByRole('status')).toHaveTextContent("Couldn't save this pick.");
    expect(button('TEN')).toHaveAccessibleName(expect.stringMatching(/, not saved, retry$/));
    expect(container.querySelector('.cursor')).toBeNull();
    expect(screen.getByTestId('game-card').parentElement).toHaveStyle({ border: '2px solid var(--ps-danger)' });
    // The cursor target survives the edge change so the next-lock link still lands here.
    expect(screen.getByTestId('game-card').parentElement).toHaveAttribute('id', 'pickem-cursor');
    await user.click(screen.getByRole('button', { name: 'Retry saving pick, NYJ at TEN' }));
    expect(onRetry).toHaveBeenCalledWith('NYJ|TEN');
  });

  test('refused on an open card (a locked rank): the words, no Retry', () => {
    render(<GameCard view={baseView({ myPick: 'TEN', confidence: 4 })} mode="confidence" slateSize={14} saveState={{ status: 'refused', message: 'Rank 9 is locked to PHI @ MIN. Choose another rank.' }} />);
    expect(screen.getByRole('status')).toHaveTextContent('Rank 9 is locked to PHI @ MIN. Choose another rank.');
    expect(screen.queryByRole('button', { name: /Retry/ })).not.toBeInTheDocument();
    expect(screen.getByTestId('confidence-menu')).toHaveAttribute('data-bad', 'true');
  });

  test('refused on a locked card: drawn Locked with the kicked-off words, its buttons disabled', () => {
    render(
      <GameCard
        view={baseView({ lock: true, phase: 'live', status: 'in_progress' })}
        saveState={{ status: 'refused', message: "This pick wasn't saved: NYJ @ TEN had already kicked off. Your other picks are saved." }}
      />
    );
    expect(screen.getByRole('status')).toHaveTextContent("This pick wasn't saved: NYJ @ TEN had already kicked off. Your other picks are saved.");
    expect(screen.getByTestId('locked-badge')).toHaveTextContent('Locked');
    expect(button('NYJ')).toBeDisabled();
    expect(screen.getByTestId('game-card').parentElement).toHaveStyle({ border: '2px solid var(--ps-danger)' });
  });

  test('a locked card carries the same one status node, empty at rest', () => {
    render(<GameCard view={baseView({ lock: true, phase: 'live', status: 'in_progress' })} />);
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  test('ONE status node in every phase: the same element persists from open to locked and into the refused words', () => {
    const { rerender } = render(<GameCard view={baseView()} />);
    const node = screen.getByRole('status');
    rerender(<GameCard view={baseView()} saveState={{ status: 'saving', attempted: { pickedTeam: 'TEN' } }} />);
    expect(screen.getByRole('status')).toBe(node);
    // The 409 refetch: the card is locked now, and the refused text goes into the existing node.
    rerender(
      <GameCard
        view={baseView({ lock: true, phase: 'live', status: 'in_progress' })}
        saveState={{ status: 'refused', message: "This pick wasn't saved: NYJ @ TEN had already kicked off. Your other picks are saved." }}
      />
    );
    expect(screen.getByRole('status')).toBe(node);
    expect(node).toHaveTextContent("had already kicked off");
    expect(screen.getAllByRole('status')).toHaveLength(1);
    rerender(<GameCard view={baseView({ lock: true, phase: 'final', winner: 'TEN', outcome: 'no-pick' })} />);
    expect(screen.getByRole('status')).toBe(node);
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  test('a busy rank change is a plain Dim line: no alert, no buttons', () => {
    render(<GameCard view={baseView({ myPick: 'TEN', confidence: 4 })} mode="confidence" slateSize={14} saveState={{ status: 'busy', message: 'Another rank is still saving. Choose this rank again in a moment.' }} />);
    expect(screen.getByRole('status')).toHaveTextContent('Another rank is still saving. Choose this rank again in a moment.');
    expect(screen.queryByRole('button', { name: /Retry|Undo/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByTestId('game-card').parentElement).toHaveStyle({ border: '4px solid transparent' });
  });

  describe('focus after Undo or Retry', () => {
    test('Undo: focus returns to the team button that now holds the pick once the save settles', async () => {
      const user = userEvent.setup();
      const onUndo = jest.fn();
      const { rerender } = render(<GameCard view={baseView({ myPick: 'TEN' })} saveState={{ status: 'saved', focusTeam: 'NYJ' }} onUndo={onUndo} />);
      await user.click(screen.getByRole('button', { name: /^Undo pick/ }));
      // Undo unmounts while the request is in flight: focus drops to the page.
      rerender(<GameCard view={baseView({ myPick: 'TEN' })} saveState={{ status: 'saving', attempted: { pickedTeam: null }, focusTeam: 'NYJ' }} />);
      expect(document.body).toHaveFocus();
      rerender(<GameCard view={baseView({ myPick: 'NYJ' })} saveState={{ status: 'undone', focusTeam: 'NYJ' }} />);
      expect(button('NYJ')).toHaveFocus();
    });

    test('Retry: focus goes to the attempted team, whether the second try lands or fails again', async () => {
      const user = userEvent.setup();
      const failed = { status: 'failed', attempted: { pickedTeam: 'TEN' }, message: "Couldn't save this pick.", focusTeam: 'TEN' };
      const { rerender } = render(<GameCard view={baseView()} saveState={failed} onRetry={() => {}} />);
      await user.click(screen.getByRole('button', { name: /^Retry saving pick/ }));
      rerender(<GameCard view={baseView()} saveState={{ status: 'saving', attempted: { pickedTeam: 'TEN' }, focusTeam: 'TEN' }} />);
      rerender(<GameCard view={baseView()} saveState={failed} />);
      expect(button('TEN')).toHaveFocus();
    });

    test('a refused Undo on a card that locked: the buttons are disabled, so the card itself takes focus', async () => {
      const user = userEvent.setup();
      const { rerender } = render(<GameCard view={baseView({ myPick: 'TEN' })} saveState={{ status: 'saved', focusTeam: 'TEN' }} onUndo={() => {}} />);
      await user.click(screen.getByRole('button', { name: /^Undo pick/ }));
      rerender(<GameCard view={baseView({ lock: true, phase: 'live', status: 'in_progress', myPick: 'TEN' })} saveState={{ status: 'refused', message: "Undo didn't go through: NYJ @ TEN kicked off. Your pick TEN stands.", focusTeam: 'TEN' }} />);
      expect(screen.getByTestId('game-card')).toHaveFocus();
    });

    test('a settled state that arrives with no Undo or Retry pressed never takes focus', () => {
      const outside = document.createElement('button');
      document.body.appendChild(outside);
      outside.focus();
      const { rerender } = render(<GameCard view={baseView()} />);
      rerender(<GameCard view={baseView({ myPick: 'TEN' })} saveState={{ status: 'saved', focusTeam: 'TEN' }} />);
      expect(outside).toHaveFocus();
      outside.remove();
    });
  });

});

describe('confidence', () => {
  test('the select reads "Confidence: none" and is disabled, pointing at the window hint, until a team is picked', () => {
    render(<GameCard view={baseView()} mode="confidence" slateSize={14} hintId="hint-1" />);
    const select = screen.getByRole('combobox', { name: 'Confidence for NYJ at TEN' });
    expect(select).toBeDisabled();
    expect(select).toHaveDisplayValue('Confidence: none');
    expect(select).toHaveAttribute('aria-describedby', 'hint-1');
  });

  test('a ranked pick: the select shows the rank and reports a change', async () => {
    const user = userEvent.setup();
    const onSetConfidence = jest.fn();
    render(<GameCard view={baseView({ myPick: 'TEN', confidence: 14 })} mode="confidence" slateSize={16} onSetConfidence={onSetConfidence} />);
    const select = screen.getByRole('combobox', { name: 'Confidence for NYJ at TEN' });
    expect(select).toBeEnabled();
    expect(select).toHaveDisplayValue('Confidence 14');
    await user.selectOptions(select, 'Confidence 3');
    expect(onSetConfidence).toHaveBeenCalledWith('NYJ|TEN', 3);
  });

  test('a draft team enables the select and, when the card holds focus, moves focus to it (#1340)', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<GameCard view={baseView()} mode="confidence" slateSize={16} onPickWinner={() => {}} />);
    await user.click(button('NYJ'));
    rerender(
      <GameCard
        view={baseView()}
        mode="confidence"
        slateSize={16}
        saveState={{ status: 'draft', attempted: { pickedTeam: 'NYJ' } }}
      />
    );
    expect(screen.getByRole('combobox', { name: 'Confidence for NYJ at TEN' })).toBeEnabled();
    expect(screen.getByRole('combobox', { name: 'Confidence for NYJ at TEN' })).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent('Choose a confidence to save this pick.');
  });

  test('a draft arriving while focus is elsewhere never steals focus (#1340)', () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    const { rerender } = render(<GameCard view={baseView()} mode="confidence" slateSize={16} />);
    rerender(<GameCard view={baseView()} mode="confidence" slateSize={16} saveState={{ status: 'draft', attempted: { pickedTeam: 'NYJ' } }} />);
    expect(outside).toHaveFocus();
    outside.remove();
  });

  test('a ranked pick does not offer "Confidence: none", an unranked one does', () => {
    const { rerender } = render(<GameCard view={baseView({ myPick: 'TEN', confidence: 4 })} mode="confidence" slateSize={14} />);
    expect(screen.queryByRole('option', { name: 'Confidence: none' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Confidence for NYJ at TEN' })).toHaveDisplayValue('Confidence 4');
    rerender(<GameCard view={baseView({ myPick: 'TEN', confidence: null })} mode="confidence" slateSize={14} />);
    expect(screen.getByRole('option', { name: 'Confidence: none' })).toBeInTheDocument();
  });

  test('straight-up mode draws no confidence select', () => {
    render(<GameCard view={baseView({ myPick: 'NYJ' })} mode="straight" />);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
});

test('state 4: live - the clock chip, Locked, situation, two-sided win probability and the reveal tally', () => {
  render(
    <GameCard
      view={baseView({
        phase: 'live',
        lock: true,
        myPick: 'NYJ',
        homeScore: 20,
        awayScore: 17,
        quarter: 'Q3',
        timeRemaining: '11:30',
        situation: { possession: 'NYJ', downDistance: '2nd & 10 at TEN 25', homeWinProbability: 0.61 },
        reveal: { counts: { NYJ: 7, TEN: 2 }, noPick: 1 },
      })}
      totalManagers={10}
    />
  );
  expect(screen.getByTestId('live-badge')).toHaveTextContent('Q3 · 11:30');
  expect(screen.getByTestId('locked-badge')).toHaveTextContent('Locked');
  expect(screen.getAllByTestId('team-score')).toHaveLength(2);
  expect(screen.getByText(/2nd & 10 at TEN 25/)).toBeInTheDocument();
  expect(screen.getByText('NYJ ball')).toBeInTheDocument();
  expect(screen.getByTestId('possession-dot')).toBeInTheDocument();
  expect(screen.getByTestId('reveal-counts')).toHaveTextContent('NYJ 7, TEN 2');
  expect(screen.getByText('1 no pick')).toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'New York Jets 39%, Tennessee Titans 61% win probability' })).toBeInTheDocument();
  expect(screen.getByTestId('game-card')).not.toHaveTextContent(/Endzone Forecast/);
  expect(button('NYJ')).toBeDisabled();
  expect(button('NYJ')).toHaveAccessibleName(expect.stringContaining('17 points, has the ball'));
});

test('a live card with no clock yet still reads Locked, with its kickoff, and no Live chip', () => {
  render(<GameCard view={baseView({ phase: 'live', lock: true, status: 'in_progress' })} />);
  expect(screen.queryByTestId('live-badge')).not.toBeInTheDocument();
  expect(screen.getByTestId('locked-badge')).toBeInTheDocument();
});

test('state 4b: an unlocked card never shows a reveal, whatever the model says: the render gates on phase', () => {
  render(<GameCard view={baseView({ phase: 'open', reveal: null })} totalManagers={10} />);
  expect(screen.queryByTestId('reveal-counts')).not.toBeInTheDocument();
});

describe('final', () => {
  const finalView = (overrides) => baseView({
    phase: 'final', lock: true, winner: 'TEN', homeScore: 13, awayScore: 10, headline: 'Titans hold off the Jets', ...overrides,
  });

  test('correct: Final chip, the outcome with its points, the headline, the winner bordered in Ink', () => {
    render(<GameCard view={finalView({ myPick: 'TEN', confidence: 9, outcome: 'correct' })} mode="confidence" />);
    expect(screen.getByTestId('final-badge')).toHaveTextContent('Final');
    expect(screen.getByTestId('outcome-badge')).toHaveTextContent('Correct · +9');
    expect(screen.getByTestId('headline')).toHaveTextContent('Titans hold off the Jets');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(button('TEN')).toHaveStyle({ borderColor: 'var(--ps-ink)' });
    expect(button('TEN')).toHaveAccessibleName(expect.stringMatching(/winner$/));
  });

  test('missed names the pick, is an outlined Ink chip, and both buttons are disabled with no opacity', () => {
    render(<GameCard view={finalView({ myPick: 'NYJ', outcome: 'missed' })} />);
    const chip = screen.getByTestId('outcome-badge');
    expect(chip).toHaveTextContent('Missed · picked NYJ');
    expect(chip).toHaveStyle({ borderColor: 'var(--ps-ink)' });
    expect(button('NYJ')).toBeDisabled();
    expect(button('TEN')).toBeDisabled();
    expect(button('NYJ')).toHaveAttribute('aria-pressed', 'true');
  });

  test('no pick, and a tie that credits nobody', () => {
    const { rerender } = render(<GameCard view={finalView({ outcome: 'no-pick' })} />);
    expect(screen.getByTestId('outcome-badge')).toHaveTextContent('No pick');
    rerender(<GameCard view={finalView({ myPick: 'NYJ', isTie: true, winner: null, outcome: 'tie' })} />);
    expect(screen.getByTestId('outcome-badge')).toHaveTextContent('Tie · no credit');
  });
});

test('loading renders a skeleton with no interactive controls', () => {
  render(<GameCard view={baseView()} loading />);
  expect(screen.getByTestId('game-card-skeleton')).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

test('bare: no line, venue or weather yet, still shows the pick count and no odds badge', () => {
  render(<GameCard view={baseView({ pickedCount: 8 })} totalManagers={10} />);
  expect(screen.getByTestId('picked-count')).toHaveTextContent('8 of 10 managers have picked');
  expect(screen.queryByTestId('odds-badge')).not.toBeInTheDocument();
});

test('house style: no em-dash, no "insight", no dash token and no opacity on the card', () => {
  const { container } = render(
    <GameCard
      view={baseView({
        phase: 'final', lock: true, myPick: 'TEN', winner: 'TEN', confidence: 9, outcome: 'correct', headline: 'Titans hold on late',
      })}
      mode="confidence"
    />
  );
  const card = screen.getByTestId('game-card');
  // The codepoint is named, not pasted (NflGameStrip.test.jsx's deliberate escape).
  expect(card.textContent).not.toMatch(/—/);
  expect(card.textContent.toLowerCase()).not.toMatch(/insight/);
  expect(container.innerHTML).not.toMatch(/dash-|opacity/);
});
