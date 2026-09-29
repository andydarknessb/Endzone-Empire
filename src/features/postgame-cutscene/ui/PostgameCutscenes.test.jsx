import fs from 'fs';
import path from 'path';
import React from 'react';
import {
  render, screen, fireEvent, act, within,
} from '@testing-library/react';
import apiClient from '../../../api/apiClient';
import PostgameCutscenes from './PostgameCutscenes';
import { planQueue, recordLine } from '../model/plan';
import { POSTGAME_STARTED_KEY } from '../model/sessionGuard';

jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));

function setReducedMotion(reduced) {
  window.matchMedia = jest.fn().mockImplementation((query) => ({
    matches: reduced && query.includes('reduce'),
    media: query,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    addListener: jest.fn(),
    removeListener: jest.fn(),
  }));
}

const item = (id, over = {}) => ({
  matchupId: id,
  leagueId: 10,
  leagueName: 'Sunday League',
  week: 5,
  playoff: false,
  outcome: 'win',
  me: { teamId: 100 + id, name: `Mine ${id}`, avatarStaticUrl: null, score: 120 },
  opponent: { teamId: 200 + id, name: `Theirs ${id}`, avatarStaticUrl: null, score: 100 },
  record: { wins: 3, losses: 1, ties: 0 },
  standing: { rank: 4, of: 12 },
  ...over,
});

// Renders and waits for the lazy chunk.
async function show(cutscenes) {
  const utils = render(<PostgameCutscenes cutscenes={cutscenes} />);
  await screen.findByRole('alertdialog');
  return utils;
}

const dialog = () => screen.getByRole('alertdialog');
const press = (key) => fireEvent.keyDown(dialog(), { key });
const startFromTitle = () => fireEvent.click(dialog());

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  setReducedMotion(false);
  apiClient.post.mockResolvedValue({ status: 204 });
});
afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

test('an empty list renders nothing and loads nothing', () => {
  const { container } = render(<PostgameCutscenes cutscenes={[]} />);
  expect(container).toBeEmptyDOMElement();
});

describe('title card', () => {
  test('one league reads WEEK n IS FINAL', async () => {
    await show([item(1), item(2)]);
    expect(screen.getByText('WEEK 5 IS FINAL')).toBeInTheDocument();
    expect(screen.getByText('PRESS START')).toBeInTheDocument();
    expect(dialog()).toHaveAccessibleName('WEEK 5 IS FINAL');
  });

  test('several leagues read RESULTS ARE IN with the league count', async () => {
    await show([item(1), item(2, { leagueId: 11 })]);
    expect(screen.getByText('RESULTS ARE IN · 2 LEAGUES')).toBeInTheDocument();
  });

  test('SKIP and the speaker toggle are at least 44x44', async () => {
    await show([item(1)]);
    // jest stubs stylesheets, so the size is read from the rule both buttons share.
    const css = fs.readFileSync(path.join(__dirname, 'PostgameCutscenes.css'), 'utf8');
    const rule = css.match(/\.postgame-chrome \{([^}]*)\}/)[1];
    expect(rule).toMatch(/min-width:\s*44px/);
    expect(rule).toMatch(/min-height:\s*44px/);
    ['[B] SKIP', 'Turn sound off'].forEach((name) => {
      expect(screen.getByRole('button', { name }).className).toContain('postgame-chrome');
    });
  });

  test('the footer shows only while the intro key is unset, then sets it', async () => {
    const first = await show([item(1)]);
    expect(screen.getByText('NEW · TURN OFF IN SETTINGS')).toBeInTheDocument();
    expect(window.localStorage.getItem('endzone_postgame_intro')).not.toBeNull();
    first.unmount();
    await show([item(1)]);
    expect(screen.queryByText('NEW · TURN OFF IN SETTINGS')).not.toBeInTheDocument();
  });

  test('the speaker toggle writes the per-device sound key', async () => {
    await show([item(1)]);
    fireEvent.click(screen.getByRole('button', { name: 'Turn sound off' }));
    expect(window.localStorage.getItem('endzone_postgame_sound')).toBe('0');
    fireEvent.click(screen.getByRole('button', { name: 'Turn sound on' }));
    expect(window.localStorage.getItem('endzone_postgame_sound')).toBe('1');
    // Clicking the toggle is not a tap on the card: still on the title card.
    expect(screen.getByText('PRESS START')).toBeInTheDocument();
  });

  test('starts muted when the stored preference is "0"', async () => {
    window.localStorage.setItem('endzone_postgame_sound', '0');
    await show([item(1)]);
    expect(screen.getByRole('button', { name: 'Turn sound on' })).toBeInTheDocument();
  });
});

describe('seen POSTs and the session guard', () => {
  const all = [item(1), item(2), item(3), item(4), item(5)];

  test('leaving the title card to the scenes POSTs seen for every due Matchup, beyond the cap too', async () => {
    await show(all);
    expect(apiClient.post).not.toHaveBeenCalled();
    startFromTitle();
    expect(apiClient.post.mock.calls.map((c) => c[0]).sort()).toEqual(
      [1, 2, 3, 4, 5].map((id) => `/api/user/postgame-cutscenes/${id}/seen`)
    );
    expect(JSON.parse(window.sessionStorage.getItem(POSTGAME_STARTED_KEY))).toEqual([1, 2, 3, 4, 5]);
  });

  test('SKIP does the same and ends the queue', async () => {
    await show(all);
    fireEvent.click(screen.getByRole('button', { name: '[B] SKIP' }));
    expect(apiClient.post).toHaveBeenCalledTimes(5);
    expect(JSON.parse(window.sessionStorage.getItem(POSTGAME_STARTED_KEY))).toEqual([1, 2, 3, 4, 5]);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  test('Escape on the title card does the same', async () => {
    await show(all);
    press('Escape');
    expect(apiClient.post).toHaveBeenCalledTimes(5);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  test('a rejected seen POST is swallowed', async () => {
    apiClient.post.mockRejectedValue(new Error('offline'));
    await show([item(1)]);
    startFromTitle();
    await act(async () => { await Promise.resolve(); });
    expect(dialog()).toBeInTheDocument();
  });

  test('POSTs once even if the sequence is left twice', async () => {
    await show([item(1)]);
    startFromTitle();
    press('Escape');
    expect(apiClient.post).toHaveBeenCalledTimes(1);
  });
});

describe('queue', () => {
  test('planQueue keeps the first three in order and tallies the rest, ties only when present', () => {
    const list = [item(1), item(2), item(3),
      item(4, { outcome: 'win' }), item(5, { outcome: 'loss' }), item(6, { outcome: 'loss' })];
    expect(planQueue(list).scenes.map((s) => s.matchupId)).toEqual([1, 2, 3]);
    expect(planQueue(list).overflowText).toBe('3 MORE RESULTS: 1-2');
    expect(planQueue([...list, item(7, { outcome: 'tie' })]).overflowText).toBe('4 MORE RESULTS: 1-2-1');
    expect(planQueue(list.slice(0, 3)).overflowText).toBeNull();
  });

  test('scenes play in the list order and tap advances', async () => {
    await show([item(1), item(2), item(3)]);
    startFromTitle();
    expect(screen.getByText('Mine 1')).toBeInTheDocument();
    fireEvent.click(dialog());
    expect(screen.getByText('Mine 2')).toBeInTheDocument();
    fireEvent.click(dialog());
    expect(screen.getByText('Mine 3')).toBeInTheDocument();
    fireEvent.click(dialog());
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  test('Enter and Space advance the same way', async () => {
    await show([item(1), item(2), item(3)]);
    press('Enter');
    expect(screen.getByText('Mine 1')).toBeInTheDocument();
    press(' ');
    expect(screen.getByText('Mine 2')).toBeInTheDocument();
    press('Enter');
    expect(screen.getByText('Mine 3')).toBeInTheDocument();
  });

  test('the overlay is an alertdialog named by the result sentence', async () => {
    await show([item(1)]);
    startFromTitle();
    expect(dialog()).toHaveAccessibleName('Mine 1 beat Theirs 1, 120 to 100');
  });

  test('Escape mid-queue ends it with no overflow line', async () => {
    await show([item(1), item(2), item(3), item(4)]);
    startFromTitle();
    press('Escape');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  test('four and beyond collapse into one snackbar after the last scene', async () => {
    jest.useFakeTimers();
    render(<PostgameCutscenes cutscenes={[
      item(1), item(2), item(3), item(4, { outcome: 'loss' }), item(5, { outcome: 'tie' }),
    ]}
    />);
    await screen.findByRole('alertdialog');
    startFromTitle();
    fireEvent.click(dialog());
    fireEvent.click(dialog());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    fireEvent.click(dialog());
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('2 MORE RESULTS: 0-1-1');
    act(() => { jest.advanceTimersByTime(6000); });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  test('a scene advances on its own timer', async () => {
    jest.useFakeTimers();
    render(<PostgameCutscenes cutscenes={[item(1), item(2)]} />);
    await screen.findByRole('alertdialog');
    startFromTitle();
    expect(screen.getByText('Mine 1')).toBeInTheDocument();
    act(() => { jest.advanceTimersByTime(3500); });
    expect(screen.getByText('Mine 2')).toBeInTheDocument();
    act(() => { jest.advanceTimersByTime(3500); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});

describe('keyboard and focus', () => {
  test('Tab is refused when nothing inside can take focus', async () => {
    await show([item(1)]);
    startFromTitle();
    expect(within(dialog()).queryAllByRole('link')).toHaveLength(0);
    dialog().focus();
    const notPrevented = fireEvent.keyDown(dialog(), { key: 'Tab' });
    expect(notPrevented).toBe(false);
    expect(dialog()).toHaveFocus();
  });

  test('Tab wraps between the two title card buttons', async () => {
    await show([item(1)]);
    const sound = screen.getByRole('button', { name: 'Turn sound off' });
    const skip = screen.getByRole('button', { name: '[B] SKIP' });
    skip.focus();
    expect(fireEvent.keyDown(skip, { key: 'Tab' })).toBe(false);
    expect(sound).toHaveFocus();
    expect(fireEvent.keyDown(sound, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(skip).toHaveFocus();
  });

  test('Enter on a focused button is not also a tap on the card', async () => {
    await show([item(1)]);
    const sound = screen.getByRole('button', { name: 'Turn sound off' });
    sound.focus();
    fireEvent.keyDown(sound, { key: 'Enter' });
    expect(screen.getByText('PRESS START')).toBeInTheDocument();
  });

  test('focus lands on the overlay and is restored to the prior element on close', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    render(<PostgameCutscenes cutscenes={[item(1)]} />);
    await screen.findByRole('alertdialog');
    expect(dialog()).toHaveFocus();
    press('Escape');
    expect(opener).toHaveFocus();
    opener.remove();
  });

  test('focus that wanders outside is pulled back', async () => {
    await show([item(1)]);
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    expect(dialog()).toHaveFocus();
    outside.remove();
  });
});

describe('static result card', () => {
  test('a win shows the outcome, both Teams and scores, the Record line and no link', async () => {
    await show([item(1)]);
    startFromTitle();
    const card = screen.getByTestId('postgame-result-card');
    expect(within(card).getByText('YOU WIN!')).toBeInTheDocument();
    expect(within(card).getByText('Mine 1')).toBeInTheDocument();
    expect(within(card).getByText('Theirs 1')).toBeInTheDocument();
    expect(within(card).getByText('120')).toBeInTheDocument();
    expect(within(card).getByText('100')).toBeInTheDocument();
    expect(within(card).getByText('RECORD 3-1 · 4TH OF 12')).toBeInTheDocument();
    expect(within(card).queryByRole('link')).not.toBeInTheDocument();
  });

  test('a loss reads GAME OVER. and links to the league Waiver wire', async () => {
    await show([item(1, {
      outcome: 'loss', leagueId: 77, me: { ...item(1).me, score: 90 },
    })]);
    startFromTitle();
    expect(screen.getByText('GAME OVER.')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'RETREAT TO THE WAIVER WIRE' });
    expect(link).toHaveAttribute('href', '#/league/77/waivers');
  });

  test('following the loss link ends the queue', async () => {
    await show([item(1, { outcome: 'loss' }), item(2)]);
    startFromTitle();
    fireEvent.click(screen.getByRole('link', { name: 'RETREAT TO THE WAIVER WIRE' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  test('a tie reads TIE GAME', async () => {
    await show([item(1, { outcome: 'tie' })]);
    startFromTitle();
    expect(screen.getByText('TIE GAME')).toBeInTheDocument();
  });

  test('a playoff week reads PLAYOFF WEEK in place of the Record line', async () => {
    await show([item(1, { playoff: true, record: null, standing: null })]);
    startFromTitle();
    expect(screen.getByText('PLAYOFF WEEK')).toBeInTheDocument();
    expect(screen.queryByText(/^RECORD/)).not.toBeInTheDocument();
  });

  test('the Record comes from the standings entity: ties only once one has happened', () => {
    expect(recordLine(item(1, { record: { wins: 3, losses: 1, ties: 0 } }))).toBe('RECORD 3-1 · 4TH OF 12');
    expect(recordLine(item(1, { record: { wins: 3, losses: 1, ties: 2 }, standing: { rank: 2, of: 12 } })))
      .toBe('RECORD 3-1-2 · 2ND OF 12');
    expect(recordLine(item(1, { standing: { rank: 11, of: 12 } }))).toBe('RECORD 3-1 · 11TH OF 12');
    expect(recordLine(item(1, { standing: { rank: 23, of: 30 } }))).toBe('RECORD 3-1 · 23RD OF 30');
  });

  test('an avatar with no image falls back to initials', async () => {
    await show([item(1)]);
    startFromTitle();
    expect(within(screen.getByTestId('postgame-side-me')).getByText('M1')).toBeInTheDocument();
  });

  test('an avatar image is the static URL', async () => {
    const withAvatar = item(1);
    withAvatar.me.avatarStaticUrl = 'https://img.example/still.png';
    await show([withAvatar]);
    startFromTitle();
    expect(within(screen.getByTestId('postgame-side-me')).getByRole('img', { hidden: true }))
      .toHaveAttribute('src', 'https://img.example/still.png');
  });
});

describe('reduced motion', () => {
  beforeEach(() => setReducedMotion(true));

  test('renders the card at once, with no title card, and POSTs seen on mount', async () => {
    await show([item(1), item(2)]);
    expect(screen.queryByText('PRESS START')).not.toBeInTheDocument();
    expect(screen.queryByTestId('postgame-title-card')).not.toBeInTheDocument();
    expect(screen.getByTestId('postgame-result-card')).toBeInTheDocument();
    expect(apiClient.post).toHaveBeenCalledTimes(2);
    expect(dialog()).toHaveAccessibleName('Mine 1 beat Theirs 1, 120 to 100');
  });

  test('each card holds for 2 s', async () => {
    jest.useFakeTimers();
    render(<PostgameCutscenes cutscenes={[item(1), item(2)]} />);
    await screen.findByRole('alertdialog');
    act(() => { jest.advanceTimersByTime(1999); });
    expect(screen.getByText('Mine 1')).toBeInTheDocument();
    act(() => { jest.advanceTimersByTime(1); });
    expect(screen.getByText('Mine 2')).toBeInTheDocument();
    act(() => { jest.advanceTimersByTime(2000); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
