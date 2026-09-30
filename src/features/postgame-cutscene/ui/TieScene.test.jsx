import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import React from 'react';
import {
  render, screen, act,
} from '@testing-library/react';
import TieScene, {
  REF_MS, MARQUEE_MS, DONE_MS, REF_FRAME_MS,
} from './TieScene';
import { REF_FLAT_A, REF_FLAT_B, frameRects } from './sprites';
import { tallyLine } from './Transition';
import { contrastRatio } from '../../../theme/contrast';

const css = fs.readFileSync(path.join(__dirname, 'TieScene.css'), 'utf8');

const cutscene = (over = {}) => ({
  matchupId: 1,
  leagueId: 10,
  leagueName: 'Sunday League',
  week: 5,
  playoff: false,
  outcome: 'tie',
  me: { teamId: 101, name: 'Mine 1', avatarStaticUrl: null, score: 110 },
  opponent: { teamId: 201, name: 'Theirs 1', avatarStaticUrl: null, score: 110 },
  record: { wins: 3, losses: 1, ties: 1 },
  standing: { rank: 5, of: 12 },
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
    <TieScene cutscene={cutscene(over)} sfx={sfx} onDone={onDone} onLeave={onLeave} {...extra} />,
  );
  return {
    sfx, onDone, onLeave, ...utils,
  };
}

const advance = (ms) => act(() => { jest.advanceTimersByTime(ms); });
const beat = () => screen.getByTestId('tie-scene').getAttribute('data-beat');

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('timeline', () => {
  test('the ledger holds the beat sheet', () => {
    expect([REF_MS, MARQUEE_MS, DONE_MS, REF_FRAME_MS]).toEqual([1000, 4000, 7000, 260]);
  });

  test('the beats change at 1000 and 4000 ms', () => {
    mount();
    expect(beat()).toBe('sweep');
    advance(999);
    expect(beat()).toBe('sweep');
    advance(1);
    expect(beat()).toBe('ref');
    advance(MARQUEE_MS - REF_MS - 1);
    expect(beat()).toBe('ref');
    advance(1);
    expect(beat()).toBe('marquee');
  });

  test('onDone fires once, at 7000 ms', () => {
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
    advance(500);
    unmount();
    sfx.calls.length = 0;
    advance(DONE_MS);
    expect(onDone).not.toHaveBeenCalled();
    expect(sfx.calls).toEqual([]);
  });

  test('the opening is the shared transition with the tally line, then it is gone at 1.0 s', () => {
    mount();
    expect(screen.getByTestId('postgame-transition')).toBeInTheDocument();
    advance(REF_MS - 1);
    expect(screen.getByTestId('postgame-typed')).toHaveTextContent(tallyLine(5));
    expect(screen.getByTestId('postgame-typed')).toHaveTextContent('WEEK 5 FINAL... TALLYING SCORES...');
    advance(1);
    expect(screen.queryByTestId('postgame-transition')).not.toBeInTheDocument();
  });
});

describe('sound', () => {
  test('slide plays at 0 ms, before any timer runs', () => {
    const { sfx } = mount();
    expect(sfx.calls).toEqual(['play:slide']);
  });

  test('tieSting plays at 1.0 s, and nothing else plays or loops', () => {
    const { sfx } = mount();
    advance(REF_MS - 1);
    expect(sfx.calls).toEqual(['play:slide']);
    advance(1);
    expect(sfx.calls).toEqual(['play:slide', 'play:tieSting']);
    advance(DONE_MS);
    expect(sfx.calls).toEqual(['play:slide', 'play:tieSting']);
    expect(sfx.startLoop).not.toHaveBeenCalled();
  });

  test('the scene never stops the sound: the queue owns stopAll', () => {
    const sfx = { ...makeSfx(), stopAll: jest.fn() };
    render(<TieScene cutscene={cutscene()} sfx={sfx} onDone={jest.fn()} />);
    advance(DONE_MS);
    expect(sfx.stopAll).not.toHaveBeenCalled();
  });
});

describe('the referee frame', () => {
  test('it arrives at 1.0 s with the sky, the crowd, the goal post and the referee', () => {
    mount();
    expect(screen.queryByTestId('tie-referee')).not.toBeInTheDocument();
    advance(REF_MS);
    ['tie-daysky', 'tie-crowd', 'tie-goalpost', 'tie-referee'].forEach((id) => {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    });
  });

  test('the referee bounces between two frames every 260 ms', () => {
    mount();
    advance(REF_MS);
    const ref = () => screen.getByTestId('tie-referee').innerHTML;
    const first = ref();
    advance(REF_FRAME_MS - 1);
    expect(ref()).toBe(first);
    advance(1);
    const second = ref();
    expect(second).not.toBe(first);
    advance(REF_FRAME_MS);
    expect(ref()).toBe(first);
  });

  test('TIE GAME slams in at 1.0 s with the score line, and stays', () => {
    mount();
    expect(screen.queryByTestId('tie-title')).not.toBeInTheDocument();
    advance(REF_MS);
    expect(screen.getByTestId('tie-title')).toHaveTextContent('TIE GAME');
    expect(screen.getByTestId('tie-score')).toHaveTextContent('110 - 110');
    advance(DONE_MS);
    expect(screen.getByTestId('tie-title')).toHaveTextContent('TIE GAME');
  });
});

describe('Record and marquee', () => {
  test('the marquee is exactly "MY TEAM TIES OPPONENT", names whole, from 4.0 s', () => {
    mount({
      me: { teamId: 1, name: 'The Extraordinarily Long Team Name of Doom', score: 1 },
      opponent: { teamId: 2, name: 'Also Rather Long Opposition FC', score: 1 },
    });
    advance(MARQUEE_MS - 1);
    expect(screen.queryByTestId('postgame-marquee')).not.toBeInTheDocument();
    advance(1);
    expect(screen.getByTestId('postgame-marquee-text').textContent)
      .toBe('THE EXTRAORDINARILY LONG TEAM NAME OF DOOM TIES ALSO RATHER LONG OPPOSITION FC');
  });

  test('the avatar leads the marquee', () => {
    mount();
    advance(MARQUEE_MS);
    expect(screen.getByTestId('postgame-marquee-avatar')).toHaveTextContent('M1');
  });

  test('the Record is three-part once a tie has happened', () => {
    mount();
    advance(MARQUEE_MS - 1);
    expect(screen.queryByTestId('tie-record')).not.toBeInTheDocument();
    advance(1);
    expect(screen.getByTestId('tie-record')).toHaveTextContent('RECORD 3-1-1 · 5TH OF 12');
  });

  test('a playoff week reads PLAYOFF WEEK', () => {
    mount({ playoff: true, record: null, standing: null });
    advance(MARQUEE_MS);
    expect(screen.getByTestId('tie-record')).toHaveTextContent('PLAYOFF WEEK');
  });

  test('the referee and the title hold through the marquee beat: no march, no dirge', () => {
    mount();
    advance(MARQUEE_MS);
    expect(screen.getByTestId('tie-referee')).toBeInTheDocument();
    expect(screen.getByTestId('tie-title')).toBeInTheDocument();
  });

  test('a scene with no link ignores onLeave: nothing is focusable and it is never called', () => {
    const { onLeave } = mount();
    advance(DONE_MS - 1);
    expect(screen.queryByRole('link', { hidden: true })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { hidden: true })).not.toBeInTheDocument();
    expect(onLeave).not.toHaveBeenCalled();
  });
});

describe('the stylesheet', () => {
  test('every animation moves on steps() and only transform or opacity change', () => {
    const uses = [...css.matchAll(/animation:\s*([^;]+);/g)].map((m) => m[1]);
    expect(uses.length).toBeGreaterThan(0);
    uses.filter((u) => !/none/.test(u)).forEach((u) => expect(u).toMatch(/steps\(\d+\)/));
    const keyframes = [...css.matchAll(/@keyframes [\w-]+ \{((?:[^{}]*\{[^}]*\})+)\s*\}/g)];
    expect(keyframes.length).toBeGreaterThan(0);
    keyframes.forEach(([, body]) => {
      const props = [...body.matchAll(/([\w-]+):/g)].map((m) => m[1]);
      props.forEach((prop) => expect(['transform', 'opacity']).toContain(prop));
    });
  });

  test('TIE GAME slams once on steps(6) and never blinks', () => {
    const rule = css.match(/\.tie-title-text \{([^}]*)\}/)[1];
    expect(rule).toMatch(/animation:\s*tie-slam 420ms steps\(6\) forwards/);
    expect(rule).not.toMatch(/infinite/);
  });

  test('TIE GAME and the score line sit on a solid band with 4.5:1 contrast, never on the sky', () => {
    const declared = (selector, prop) => {
      const rule = css.match(new RegExp(`${selector.replace('.', '\\.')} \\{([^}]*)\\}`))[1];
      const found = rule.match(new RegExp(`(?:^|[\\s;])${prop}:\\s*(#[0-9a-fA-F]{6})\\s*;`));
      return found && found[1];
    };
    const band = declared('.tie-title', 'background');
    expect(band).toBeTruthy();
    ['.tie-title-text', '.tie-title-score'].forEach((selector) => {
      const color = declared(selector, 'color');
      expect(color).toBeTruthy();
      expect(contrastRatio(color, band)).toBeGreaterThanOrEqual(4.5);
    });
  });

  test('the scene reads no other scene\'s variable', () => {
    expect(css).not.toMatch(/var\(--win|var\(--loss/);
  });

  test('every new color literal is allowlisted for the color guard', () => {
    const root = path.join(__dirname, '..', '..', '..', '..');
    const guard = fs.readFileSync(path.join(root, 'scripts', 'check-color-literals.js'), 'utf8');
    expect(guard).toContain("'src/features/postgame-cutscene/ui/TieScene.css'");
    expect(guard).toContain("'src/features/postgame-cutscene/ui/Transition.css'");
    expect(guard).toContain("'src/features/postgame-cutscene/ui/Marquee.css'");
    const out = execFileSync('node', [path.join(root, 'scripts', 'check-color-literals.js')], { encoding: 'utf8' });
    expect(out).toMatch(/No hard-coded color literals/);
  });
});

describe('sprites', () => {
  test('each referee frame is 16x16 in the fixed role letters, nothing added to shared/ui', () => {
    [REF_FLAT_A, REF_FLAT_B].forEach((rows) => {
      expect(rows).toHaveLength(16);
      rows.forEach((row) => expect(row).toMatch(/^[.SWB]{16}$/));
    });
  });

  test('the arms are horizontal: a full-width sleeve row, hands at both edges', () => {
    const arms = REF_FLAT_A.find((row) => /^S+[WB]+S+$/.test(row));
    expect(arms).toBeDefined();
    expect(arms[0]).toBe('S');
    expect(arms[15]).toBe('S');
  });

  test('B is A bounced by exactly one pixel row', () => {
    expect(REF_FLAT_B).not.toEqual(REF_FLAT_A);
    expect(REF_FLAT_B.slice(0, 15)).toEqual(REF_FLAT_A.slice(1));
  });

  test('the frames paint with the fixed colors only', () => {
    const fills = frameRects(REF_FLAT_A, {}).map((r) => r.fill);
    expect(fills.length).toBeGreaterThan(0);
    fills.forEach((fill) => expect(fill).toMatch(/^#[0-9a-f]{6}$/));
  });
});
