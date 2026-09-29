import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import React from 'react';
import {
  render, screen, act, fireEvent, within,
} from '@testing-library/react';
import LossScene, {
  STADIUM_MS, LIGHTNING_MS, PAN_MS, PANEL_MS, DONE_MS, WALK_FRAME_MS, BLINK_MS, BLINK_COUNT,
  FLASH_FRAME_MS, FLASH_MS, PAN_STEPS, COUNT_STEPS, COUNT_START_MS, COUNT_STEP_MS,
} from './LossScene';
import { kitForTeam } from '../model/teamKit';
import {
  HELMET, SLOUCH, SLOUCH_A, SLOUCH_B, frameRects,
} from './sprites';

const css = fs.readFileSync(path.join(__dirname, 'LossScene.css'), 'utf8');

const cutscene = (over = {}) => ({
  matchupId: 1,
  leagueId: 10,
  leagueName: 'Sunday League',
  week: 5,
  playoff: false,
  outcome: 'loss',
  me: { teamId: 101, name: 'Mine 1', avatarStaticUrl: null, score: 90 },
  opponent: { teamId: 201, name: 'Theirs 1', avatarStaticUrl: null, score: 121 },
  record: { wins: 3, losses: 2, ties: 0 },
  standing: { rank: 7, of: 12 },
  ...over,
});

function makeSfx() {
  const calls = [];
  return {
    calls,
    play: jest.fn((name) => calls.push(`play:${name}`)),
    startLoop: jest.fn((name) => calls.push(`startLoop:${name}`)),
  };
}

function mount(over = {}, extra = {}) {
  const sfx = makeSfx();
  const onDone = jest.fn();
  const onLeave = jest.fn();
  const utils = render(
    <LossScene cutscene={cutscene(over)} sfx={sfx} onDone={onDone} onLeave={onLeave} {...extra} />,
  );
  return {
    sfx, onDone, onLeave, ...utils,
  };
}

const advance = (ms) => act(() => { jest.advanceTimersByTime(ms); });
const beat = () => screen.getByTestId('loss-scene').getAttribute('data-beat');
const shown = (row) => screen.getByTestId(`loss-row-${row}-score`).textContent;

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('timeline', () => {
  test('the ledger holds the beat sheet', () => {
    expect([STADIUM_MS, LIGHTNING_MS, PAN_MS, PANEL_MS, DONE_MS, WALK_FRAME_MS, BLINK_MS, BLINK_COUNT])
      .toEqual([1000, 2500, 5000, 5500, 10000, 250, 500, 2]);
    expect(FLASH_MS).toBe(2 * FLASH_FRAME_MS);
    expect(PAN_STEPS).toBe(4);
    expect(COUNT_STEPS).toBe(6);
  });

  test('the beats change at 1000, 5000 and 5500 ms', () => {
    mount();
    expect(beat()).toBe('storm');
    advance(STADIUM_MS - 1);
    expect(beat()).toBe('storm');
    advance(1);
    expect(beat()).toBe('stadium');
    advance(PAN_MS - STADIUM_MS - 1);
    expect(beat()).toBe('stadium');
    advance(1);
    expect(beat()).toBe('pan');
    advance(PANEL_MS - PAN_MS - 1);
    expect(beat()).toBe('pan');
    advance(1);
    expect(beat()).toBe('panel');
  });

  test('the lightning is one flash at 2500 ms', () => {
    mount();
    advance(LIGHTNING_MS - 1);
    expect(screen.queryByTestId('loss-flash')).not.toBeInTheDocument();
    advance(1);
    expect(screen.getAllByTestId('loss-flash')).toHaveLength(1);
    advance(DONE_MS);
    expect(screen.getAllByTestId('loss-flash')).toHaveLength(1);
  });

  test('onDone fires once, at 10000 ms', () => {
    const { onDone } = mount();
    advance(DONE_MS - 1);
    expect(onDone).not.toHaveBeenCalled();
    advance(1);
    expect(onDone).toHaveBeenCalledTimes(1);
    advance(5000);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  test('unmounting stops the timers: no onDone, no sound', () => {
    const { onDone, sfx, unmount } = mount();
    advance(2000);
    unmount();
    sfx.calls.length = 0;
    advance(DONE_MS);
    expect(onDone).not.toHaveBeenCalled();
    expect(sfx.calls).toEqual([]);
  });
});

describe('sound', () => {
  test('lossChord then the rain loop at 0 ms, before any timer runs', () => {
    const { sfx } = mount();
    expect(sfx.calls).toEqual(['play:lossChord', 'startLoop:rain']);
  });

  test('thunder at 2.5 s and the dirge at 5.5 s, in that order after the opening', () => {
    const { sfx } = mount();
    const named = () => sfx.calls.filter((c) => c !== 'play:blip');
    advance(LIGHTNING_MS - 1);
    expect(named()).toEqual(['play:lossChord', 'startLoop:rain']);
    advance(1);
    expect(named()).toEqual(['play:lossChord', 'startLoop:rain', 'play:thunder']);
    advance(PANEL_MS - LIGHTNING_MS - 1);
    expect(named()).toHaveLength(3);
    advance(1);
    expect(named()).toEqual(['play:lossChord', 'startLoop:rain', 'play:thunder', 'startLoop:dirge']);
    advance(DONE_MS);
    expect(named()).toHaveLength(4);
  });

  test('the scene never stops the sound: the queue owns stopAll', () => {
    const sfx = { ...makeSfx(), stopAll: jest.fn() };
    render(<LossScene cutscene={cutscene()} sfx={sfx} onDone={jest.fn()} onLeave={jest.fn()} />);
    advance(DONE_MS);
    expect(sfx.stopAll).not.toHaveBeenCalled();
  });

  test('one tick per count step and no tick on the thunder', () => {
    const { sfx } = mount();
    advance(DONE_MS);
    expect(sfx.calls.filter((c) => c === 'play:blip')).toHaveLength(COUNT_STEPS);
    expect(sfx.calls.filter((c) => c === 'play:thunder')).toHaveLength(1);
    expect(COUNT_START_MS + COUNT_STEPS * COUNT_STEP_MS).toBeLessThan(PAN_MS);
    for (let n = 1; n <= COUNT_STEPS; n += 1) {
      expect(COUNT_START_MS + n * COUNT_STEP_MS).not.toBe(LIGHTNING_MS);
    }
  });
});

describe('scoreboard', () => {
  test('the opponent is the top row and the viewer the row below', () => {
    mount();
    advance(STADIUM_MS);
    const rows = within(screen.getByTestId('loss-scoreboard')).getAllByTestId(/^loss-row-(opponent|me)$/);
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual(['loss-row-opponent', 'loss-row-me']);
    expect(screen.getByTestId('loss-row-opponent-name')).toHaveTextContent('Theirs 1');
    expect(screen.getByTestId('loss-row-me-name')).toHaveTextContent('Mine 1');
  });

  test('both scores start at 0 and count up in 6 steps to the exact payload scores', () => {
    mount();
    advance(STADIUM_MS);
    expect([shown('opponent'), shown('me')]).toEqual(['0', '0']);
    const seen = [];
    for (let n = 1; n <= COUNT_STEPS; n += 1) {
      advance(COUNT_STEP_MS);
      seen.push([shown('opponent'), shown('me')]);
    }
    expect(seen).toHaveLength(6);
    expect(seen[5]).toEqual(['121', '90']);
    seen.slice(0, 5).forEach(([opp, me]) => {
      expect(Number(opp)).toBeLessThan(121);
      expect(Number(me)).toBeLessThan(90);
    });
    const opps = seen.map(([opp]) => Number(opp));
    expect([...opps].sort((a, b) => a - b)).toEqual(opps);
    advance(DONE_MS);
    expect([shown('opponent'), shown('me')]).toEqual(['121', '90']);
  });

  test('a fractional score lands exactly, not rounded', () => {
    mount({ me: { ...cutscene().me, score: 88.4 }, opponent: { ...cutscene().opponent, score: 101.7 } });
    advance(COUNT_START_MS + COUNT_STEPS * COUNT_STEP_MS);
    expect([shown('opponent'), shown('me')]).toEqual(['101.7', '88.4']);
  });

  test('a long name wraps: it is whole in the DOM and the CSS never truncates it', () => {
    const long = 'The Extraordinarily Long Named Fantasy Football Franchise Of Doom';
    mount({ opponent: { ...cutscene().opponent, name: long } });
    advance(STADIUM_MS);
    expect(screen.getByTestId('loss-row-opponent-name')).toHaveTextContent(long);
    expect(css).toMatch(/\.loss-name\s*\{[^}]*overflow-wrap:\s*anywhere/);
    expect(css).not.toMatch(/text-overflow/);
    expect(css).not.toMatch(/white-space:\s*nowrap/);
  });

  test('the scoreboard is amber', () => {
    expect(css).toMatch(/\.loss-board\s*\{[^}]*color:\s*#ffb000/);
  });
});

describe('the stadium and the walk', () => {
  test('the viewer walks: two frames alternating every 250 ms, the helmet dragging', () => {
    mount();
    expect(screen.queryByTestId('loss-walker')).not.toBeInTheDocument();
    advance(STADIUM_MS);
    const frame = () => screen.getByTestId('loss-player').getAttribute('data-frame');
    const first = frame();
    advance(WALK_FRAME_MS - 1);
    expect(frame()).toBe(first);
    advance(1);
    const second = frame();
    expect(second).not.toBe(first);
    advance(WALK_FRAME_MS);
    expect(frame()).toBe(first);
    expect(new Set([first, second])).toEqual(new Set(['0', '1']));
    expect(screen.getByTestId('loss-player')).toHaveAttribute('viewBox', '0 0 16 16');
    expect(screen.getByTestId('loss-helmet')).toHaveAttribute('viewBox', '0 0 8 8');
    expect(SLOUCH).toEqual([SLOUCH_A, SLOUCH_B]);
  });

  test('the walker is drawn in the viewer kit', () => {
    mount();
    advance(STADIUM_MS);
    const kit = kitForTeam(101, kitForTeam(201));
    const fills = new Set(frameRects(SLOUCH_A, kit).map(({ fill }) => fill));
    expect(fills.has(kit.jersey)).toBe(true);
    expect(fills.has(kit.pants)).toBe(true);
    expect(frameRects(HELMET, kit).some(({ fill }) => fill === kit.helmet)).toBe(true);
  });

  test('the sprites are 16x16 (the helmet 8x8) and the slouch wears no helmet', () => {
    [SLOUCH_A, SLOUCH_B].forEach((frame) => {
      expect(frame).toHaveLength(16);
      frame.forEach((row) => expect(row).toHaveLength(16));
      expect(frame.join('')).not.toMatch(/[HF]/);
    });
    expect(HELMET).toHaveLength(8);
    HELMET.forEach((row) => expect(row).toHaveLength(8));
    expect(HELMET.join('')).toMatch(/H/);
  });

  test('the stadium has two cloud bands and a crowd band', () => {
    mount();
    advance(STADIUM_MS);
    expect(screen.getAllByTestId('loss-cloud')).toHaveLength(2);
    expect(screen.getByTestId('loss-crowd')).toBeInTheDocument();
  });
});

describe('the animation CSS', () => {
  test('the scene fades to storm navy over the first second', () => {
    expect(css).toMatch(/\.loss-stage\s*\{[^}]*background:\s*#0b1020/);
    expect(css).toMatch(/animation:\s*loss-fade\s+1000ms\s+steps\(8\)/);
    expect(STADIUM_MS).toBe(1000);
  });

  test('"GAME OVER." blinks at 2 Hz for 1 s, then holds', () => {
    const match = css.match(/\.loss-gameover\s*\{[^}]*animation:\s*loss-blink\s+(\d+)ms\s+steps\(1\)\s+(\d+);/);
    expect(match).not.toBeNull();
    const [, period, count] = match;
    expect(Number(period)).toBe(BLINK_MS);
    expect(Number(count)).toBe(BLINK_COUNT);
    expect(1000 / Number(period)).toBe(2); // 2 Hz
    expect(Number(period) * Number(count)).toBe(1000); // for 1 s
    expect(css).toMatch(/\.loss-gameover\s*\{[^}]*color:\s*#d2232a/);
    expect(screen.queryByText('GAME OVER.')).toBeNull();
    mount();
    expect(screen.getByText('GAME OVER.')).toBeInTheDocument();
    advance(DONE_MS - 1);
    expect(screen.getByText('GAME OVER.')).toBeInTheDocument();
  });

  test('"GAME OVER." stacks above the opening fade so its blink is seen', () => {
    const z = (selector) => Number(css.match(new RegExp(`${selector}\\s*\\{[^}]*z-index:\\s*(\\d+)`))[1]);
    expect(z('\\.loss-gameover')).toBeGreaterThan(z('\\.loss-fade'));
  });

  test('the lightning is two frames of white at 70%, once', () => {
    expect(css).toMatch(/\.loss-flash\s*\{[^}]*animation:\s*loss-flash\s+220ms\s+steps\(1\)\s+1;/);
    expect(FLASH_MS).toBe(220);
    expect(css).toMatch(/@keyframes loss-flash\s*\{\s*from\s*\{\s*opacity:\s*0\.7;/);
    expect(css).toMatch(/\.loss-flash\s*\{[^}]*background:\s*#ffffff/);
  });

  test('rain is one layer, scrolled on steps() for the whole scene', () => {
    mount();
    advance(DONE_MS - 1);
    expect(screen.getAllByTestId('loss-rain')).toHaveLength(1);
    expect(screen.getByTestId('loss-rain').className).toBe('loss-rain');
    expect(css).toMatch(/\.loss-rain\s*\{[^}]*animation:\s*loss-rain\s+\d+ms\s+steps\(\d+\)\s+infinite;/);
    expect(css).toMatch(/#ffffff8c/); // 1px white at 55%
  });

  test('the pan is a steps(4) transform over 500 ms, not a crossfade', () => {
    expect(css).toMatch(/\[data-beat='pan'\]\s+\.loss-slide\s*\{\s*animation:\s*loss-pan\s+500ms\s+steps\(4\)\s+forwards;/);
    expect(PANEL_MS - PAN_MS).toBe(500);
    expect(PAN_STEPS).toBe(4);
    expect(css).toMatch(/@keyframes loss-pan\s*\{\s*from\s*\{\s*transform:\s*translateY\(0\);\s*\}\s*to\s*\{\s*transform:\s*translateY\(-50%\);/);
  });

  test('the walk moves on 250 ms steps', () => {
    expect(css).toMatch(/animation:\s*loss-walk\s+4000ms\s+steps\(16\)/);
    expect(4000 / 16).toBe(WALK_FRAME_MS);
  });

  test('only transform and opacity are animated', () => {
    const keyframes = css.match(/@keyframes[^{]+\{(?:[^{}]|\{[^}]*\})*\}/g) || [];
    expect(keyframes.length).toBeGreaterThan(0);
    keyframes.forEach((block) => {
      const props = [...block.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
      props.forEach((prop) => expect(['transform', 'opacity']).toContain(prop));
    });
  });

  test('sprites are 64px, 48px under 420px viewport width', () => {
    expect(css).toMatch(/\.loss-scene\s*\{[^}]*--loss-sprite:\s*64px/);
    expect(css).toMatch(/@media \(max-width: 419px\)\s*\{\s*\.loss-scene\s*\{\s*--loss-sprite:\s*48px/);
  });
});

describe('the color-literal guard', () => {
  test('the allowlist check is green with LossScene.css on it', () => {
    jest.useRealTimers();
    const script = path.join(__dirname, '..', '..', '..', '..', 'scripts', 'check-color-literals.js');
    expect(() => execFileSync(process.execPath, [script], { stdio: 'pipe' })).not.toThrow();
    expect(fs.readFileSync(script, 'utf8')).toContain("'src/features/postgame-cutscene/ui/LossScene.css'");
  });
});

describe('the panel and the waiver link', () => {
  test('the Record line and the link appear at 5.5 s, not before', () => {
    mount();
    advance(PANEL_MS - 1);
    expect(screen.queryByTestId('loss-link')).not.toBeInTheDocument();
    expect(screen.queryByTestId('loss-record')).not.toBeInTheDocument();
    advance(1);
    expect(screen.getByTestId('loss-record')).toHaveTextContent('RECORD 3-2 · 7TH OF 12');
    expect(screen.getByRole('link', { name: 'RETREAT TO THE WAIVER WIRE' })).toBeInTheDocument();
  });

  test('a playoff week reads PLAYOFF WEEK', () => {
    mount({ playoff: true, record: null, standing: null });
    advance(PANEL_MS);
    expect(screen.getByTestId('loss-record')).toHaveTextContent('PLAYOFF WEEK');
    expect(screen.queryByText(/^RECORD/)).not.toBeInTheDocument();
  });

  test('the link is a real anchor to the league Waiver wire', () => {
    mount({ leagueId: 77 });
    advance(PANEL_MS);
    const link = screen.getByRole('link', { name: 'RETREAT TO THE WAIVER WIRE' });
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', '#/league/77/waivers');
  });

  test('the link is at least 44px tall', () => {
    expect(css).toMatch(/\.loss-link\s*\{[^}]*min-height:\s*44px/);
  });

  test('the link is reachable: it is focusable and outside every aria-hidden subtree', () => {
    mount();
    advance(PANEL_MS);
    const link = screen.getByTestId('loss-link');
    link.focus();
    expect(link).toHaveFocus();
    // getByRole skips anything inside an aria-hidden subtree.
    expect(screen.getByRole('link', { name: 'RETREAT TO THE WAIVER WIRE' })).toBe(link);
    expect(screen.getByTestId('loss-scene')).not.toHaveAttribute('aria-hidden');
  });

  test('clicking the link calls onLeave once and onDone not at all', () => {
    const { onLeave, onDone } = mount();
    advance(PANEL_MS);
    fireEvent.click(screen.getByTestId('loss-link'));
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
  });

  test('rain continues over the panel', () => {
    mount();
    advance(PANEL_MS);
    expect(screen.getByTestId('loss-rain')).toBeInTheDocument();
  });
});
