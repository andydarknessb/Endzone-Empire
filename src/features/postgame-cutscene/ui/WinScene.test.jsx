import fs from 'fs';
import path from 'path';
import React from 'react';
import {
  render, screen, act, within,
} from '@testing-library/react';
import Marquee from './Marquee';
import WinScene, {
  SCROLL_MS, ENDZONE_MS, SPIKE_MS, SLAM_MS, DANCE_MS, DONE_MS, FRAME_MS, FLASH_MS,
} from './WinScene';
import {
  BALL, DANCE, DANCE_A, DIVE, SPIKE, frameRects,
} from './sprites';

const css = fs.readFileSync(path.join(__dirname, 'WinScene.css'), 'utf8');

const cutscene = (over = {}) => ({
  matchupId: 1,
  leagueId: 10,
  leagueName: 'Sunday League',
  week: 5,
  playoff: false,
  outcome: 'win',
  me: { teamId: 101, name: 'Mine 1', avatarStaticUrl: null, score: 120 },
  opponent: { teamId: 201, name: 'Theirs 1', avatarStaticUrl: null, score: 100 },
  record: { wins: 3, losses: 1, ties: 0 },
  standing: { rank: 4, of: 12 },
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
  const utils = render(<WinScene cutscene={cutscene(over)} sfx={sfx} onDone={onDone} {...extra} />);
  return { sfx, onDone, ...utils };
}

const advance = (ms) => act(() => { jest.advanceTimersByTime(ms); });
const beat = () => screen.getByTestId('win-scene').getAttribute('data-beat');

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('timeline', () => {
  test('the ledger holds the beat sheet', () => {
    expect([SCROLL_MS, ENDZONE_MS, SPIKE_MS, SLAM_MS, DANCE_MS, DONE_MS, FRAME_MS])
      .toEqual([1000, 3200, 3600, 4000, 4600, 10000, 110]);
  });

  test('the beats change at 1000, 3200, 4000 and 4600 ms', () => {
    mount();
    expect(beat()).toBe('sweep');
    advance(999);
    expect(beat()).toBe('sweep');
    advance(1);
    expect(beat()).toBe('scroll');
    advance(ENDZONE_MS - SCROLL_MS - 1);
    expect(beat()).toBe('scroll');
    advance(1);
    expect(beat()).toBe('endzone');
    advance(SLAM_MS - ENDZONE_MS - 1);
    expect(beat()).toBe('endzone');
    advance(1);
    expect(beat()).toBe('slam');
    advance(DANCE_MS - SLAM_MS - 1);
    expect(beat()).toBe('slam');
    advance(1);
    expect(beat()).toBe('dance');
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

  test('the opening is the two line sweeps and the typed line', () => {
    mount();
    expect(screen.getByTestId('win-transition')).toBeInTheDocument();
    expect(screen.getByTestId('win-typed')).toHaveTextContent('');
    advance(SCROLL_MS - 1);
    expect(screen.getByTestId('win-typed')).toHaveTextContent('WEEK 5 FINAL... TALLYING SCORES...');
    advance(1);
    expect(screen.queryByTestId('win-transition')).not.toBeInTheDocument();
  });
});

describe('sound', () => {
  test('slide plays at 0 ms, before any timer runs', () => {
    const { sfx } = mount();
    expect(sfx.calls).toEqual(['play:slide']);
  });

  test('crunch at the spike, fanfare at 4.0 s, whistle then the two loops at 4.6 s', () => {
    const { sfx } = mount();
    advance(SPIKE_MS - 1);
    expect(sfx.calls).toEqual(['play:slide']);
    advance(1);
    expect(sfx.calls).toEqual(['play:slide', 'play:crunch']);
    advance(SLAM_MS - SPIKE_MS);
    expect(sfx.calls).toEqual(['play:slide', 'play:crunch', 'play:fanfare']);
    advance(DANCE_MS - SLAM_MS - 1);
    expect(sfx.calls).toHaveLength(3);
    advance(1);
    expect(sfx.calls).toEqual([
      'play:slide', 'play:crunch', 'play:fanfare', 'play:whistle', 'startLoop:march', 'startLoop:crowd',
    ]);
    advance(DONE_MS);
    expect(sfx.calls).toHaveLength(6);
  });

  test('the scene never stops the sound: the queue owns stopAll', () => {
    const sfx = { ...makeSfx(), stopAll: jest.fn() };
    render(<WinScene cutscene={cutscene()} sfx={sfx} onDone={jest.fn()} />);
    advance(DONE_MS);
    expect(sfx.stopAll).not.toHaveBeenCalled();
  });
});

describe('the run, the dive and the spike', () => {
  test('the runner high-steps on a 110 ms cycle', () => {
    mount();
    advance(SCROLL_MS);
    const runner = () => screen.getByTestId('win-runner').innerHTML;
    const first = runner();
    advance(FRAME_MS);
    expect(runner()).not.toBe(first);
    advance(FRAME_MS);
    expect(runner()).toBe(first);
  });

  test('the end zone enters at 3.2 s with the goal post; the runner dives, then spikes at 3.6 s', () => {
    mount();
    advance(ENDZONE_MS - 1);
    expect(screen.queryByTestId('win-endzone')).not.toBeInTheDocument();
    expect(screen.queryByTestId('win-dive')).not.toBeInTheDocument();
    advance(1);
    expect(screen.getByTestId('win-endzone')).toBeInTheDocument();
    expect(screen.getByTestId('win-goalpost')).toBeInTheDocument();
    expect(screen.getByTestId('win-dive')).toBeInTheDocument();
    expect(screen.queryByTestId('win-flash')).not.toBeInTheDocument();
    advance(SPIKE_MS - ENDZONE_MS);
    expect(screen.queryByTestId('win-dive')).not.toBeInTheDocument();
    expect(screen.getByTestId('win-spike')).toBeInTheDocument();
    expect(screen.getByTestId('win-ball')).toBeInTheDocument();
    expect(screen.getByTestId('win-flash')).toBeInTheDocument();
  });

  test('the defender trails at 20% and the runner holds 35% of the stage', () => {
    expect(css.match(/\.win-runner \{([^}]*)\}/)[1]).toMatch(/left:\s*35%/);
    expect(css.match(/\.win-defender \{([^}]*)\}/)[1]).toMatch(/left:\s*20%/);
  });

  test('the dive stays on the stage: 35% plus the dive is under 100% with room for the sprite', () => {
    const to = css.match(/@keyframes win-dive \{[^}]*\}\s*to \{\s*transform:\s*translateX\((\d+)%\)/)[1];
    // 64 px of a 720 px stage is under 9%; 48 px of 320 px is 15%.
    expect(35 + Number(to) + 15).toBeLessThan(100);
    expect(css).toMatch(/\.win-scene\[data-beat='slam'\] \.win-runner-group,\s*\.win-scene\[data-beat='dance'\] \.win-runner-group \{\s*transform:\s*translateX\(36%\)/);
  });
});

describe('slam, Record and marquee', () => {
  test('YOU WIN! slams in at 4.0 s with the score line', () => {
    mount();
    advance(SLAM_MS - 1);
    expect(screen.queryByTestId('win-title')).not.toBeInTheDocument();
    advance(1);
    expect(screen.getByTestId('win-title')).toHaveTextContent('YOU WIN!');
    expect(screen.getByTestId('win-score')).toHaveTextContent('120 - 100');
    advance(DONE_MS);
    expect(screen.getByTestId('win-title')).toHaveTextContent('YOU WIN!');
  });

  test('the marquee is exactly "MY TEAM DEFEATS OPPONENT", names whole', () => {
    mount({
      me: { teamId: 1, name: 'The Extraordinarily Long Team Name of Doom', score: 1 },
      opponent: { teamId: 2, name: 'Also Rather Long Opposition FC', score: 0 },
    });
    advance(DANCE_MS - 1);
    expect(screen.queryByTestId('win-marquee')).not.toBeInTheDocument();
    advance(1);
    expect(screen.getByTestId('win-marquee-text').textContent)
      .toBe('THE EXTRAORDINARILY LONG TEAM NAME OF DOOM DEFEATS ALSO RATHER LONG OPPOSITION FC');
  });

  // jsdom lays nothing out: give the box and the track widths so a lap exists.
  function withLayout({ box, track }, fn) {
    const widths = { clientWidth: box, scrollWidth: track };
    const saved = Object.keys(widths).map((key) => [key, Object.getOwnPropertyDescriptor(HTMLElement.prototype, key)]);
    Object.entries(widths).forEach(([key, value]) => {
      Object.defineProperty(HTMLElement.prototype, key, { configurable: true, get: () => value });
    });
    try {
      fn();
    } finally {
      saved.forEach(([key, descriptor]) => {
        if (descriptor) Object.defineProperty(HTMLElement.prototype, key, descriptor);
        else delete HTMLElement.prototype[key];
      });
    }
  }
  const trackX = () => Number(
    screen.getByTestId('win-marquee-track').style.transform.match(/translateX\((-?[\d.]+)px\)/)[1]
  );

  test('the marquee moves 8 px a step, 10 steps a second, as a transform', () => {
    withLayout({ box: 300, track: 500 }, () => {
      mount();
      advance(DANCE_MS);
      const start = trackX();
      advance(100);
      expect(start - trackX()).toBe(8);
      advance(1000);
      expect(start - trackX()).toBe(88);
    });
  });

  // Press Start 2P is 1 em a character: a 40-character text plus the 32 px avatar
  // and 12 px gap. The dance beat has 54 steps; two are held back as slack.
  test.each([
    ['14 px on a 1280 px stage', { box: 1280, track: 32 + 12 + 40 * 14 }],
    ['11 px on a 375 px stage', { box: 375, track: 32 + 12 + 40 * 11 }],
  ])('the track right edge reaches the box right edge before onDone: %s', (label, layout) => {
    withLayout(layout, () => {
      mount();
      advance(DANCE_MS);
      const rightEdges = [trackX() + layout.track];
      for (let stepNo = 1; stepNo < (DONE_MS - DANCE_MS) / 100; stepNo += 1) {
        advance(100);
        rightEdges.push(trackX() + layout.track);
      }
      expect(rightEdges).toHaveLength(54);
      expect(Math.min(...rightEdges)).toBeLessThanOrEqual(layout.box);
      // The avatar is on screen from the first step, and 8 px a step is kept.
      expect(rightEdges[0] - layout.track).toBeGreaterThanOrEqual(0);
      expect(rightEdges[0] - rightEdges[1]).toBe(8);
    });
  });

  test('positive control: with no visibleByMs the lap starts off the right edge and never shows these tracks whole', () => {
    [{ box: 1280, track: 604 }, { box: 375, track: 484 }].forEach((layout) => {
      withLayout(layout, () => {
        const { unmount } = render(<Marquee text="X" name="X" />);
        const rightEdges = [trackX() + layout.track];
        for (let stepNo = 1; stepNo < 54; stepNo += 1) {
          advance(100);
          rightEdges.push(trackX() + layout.track);
        }
        expect(Math.min(...rightEdges)).toBeGreaterThan(layout.box);
        unmount();
      });
    });
  });

  test('a short track still enters from just off the right edge', () => {
    withLayout({ box: 375, track: 200 }, () => {
      mount();
      advance(DANCE_MS);
      expect(trackX()).toBe(375);
    });
  });

  test('the avatar leads the marquee: initials with no image, the still image with one', () => {
    const first = mount();
    advance(DANCE_MS);
    expect(screen.getByTestId('win-marquee-avatar')).toHaveTextContent('M1');
    first.unmount();
    mount({ me: { ...cutscene().me, avatarStaticUrl: 'https://img.example/still.png' } });
    advance(DANCE_MS);
    expect(within(screen.getByTestId('win-marquee-avatar')).getByRole('img', { hidden: true })).toHaveAttribute('src', 'https://img.example/still.png');
    expect(css).toMatch(/\.win-marquee-avatar img \{[^}]*image-rendering:\s*pixelated/);
  });

  test('a Team with only a still logo (no animated GIF) shows it in the marquee', () => {
    mount({ me: { ...cutscene().me, avatarUrl: 'https://img.example/logo.png', avatarStaticUrl: null } });
    advance(DANCE_MS);
    expect(within(screen.getByTestId('win-marquee-avatar')).getByRole('img', { hidden: true }))
      .toHaveAttribute('src', 'https://img.example/logo.png');
  });

  test('the Record line comes from the standings formatter', () => {
    mount();
    advance(DANCE_MS - 1);
    expect(screen.queryByTestId('win-record')).not.toBeInTheDocument();
    advance(1);
    expect(screen.getByTestId('win-record')).toHaveTextContent('RECORD 3-1 · 4TH OF 12');
  });

  test('a playoff week reads PLAYOFF WEEK', () => {
    mount({ playoff: true, record: null, standing: null });
    advance(DANCE_MS);
    expect(screen.getByTestId('win-record')).toHaveTextContent('PLAYOFF WEEK');
  });

  test('the dance loops three frames on the 110 ms cycle', () => {
    mount();
    advance(DANCE_MS);
    const frame = () => screen.getByTestId('win-dance').innerHTML;
    const seen = [];
    for (let i = 0; i < DANCE.length; i += 1) {
      seen.push(frame());
      advance(FRAME_MS);
    }
    expect(new Set(seen).size).toBe(3);
    expect(frame()).toBe(seen[0]);
  });
});

describe('the stylesheet', () => {
  test('the sky and the crowd scroll at half the field rate, all on steps()', () => {
    const field = Number(css.match(/--win-field-cycle:\s*(\d+)ms/)[1]);
    const sky = Number(css.match(/--win-sky-cycle:\s*(\d+)ms/)[1]);
    expect(sky).toBe(field * 2);
    expect(css.match(/\.win-layer--field \{[^}]*animation-duration:\s*var\(--win-field-cycle\)/)).not.toBeNull();
    expect(css.match(/\.win-layer--sky \{[^}]*animation-duration:\s*var\(--win-sky-cycle\)/)).not.toBeNull();
    expect(css.match(/\.win-layer--crowd \{[^}]*animation-duration:\s*var\(--win-sky-cycle\)/)).not.toBeNull();
    expect(css.match(/\.win-layer \{[^}]*animation-timing-function:\s*steps\(\d+\)/)).not.toBeNull();
  });

  test('field, sky and crowd are three separate layers', () => {
    mount();
    advance(SCROLL_MS);
    ['win-layer-field', 'win-layer-sky', 'win-layer-crowd'].forEach((id) => {
      expect(screen.getAllByTestId(id)).toHaveLength(1);
    });
  });

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

  test('the white flash is two frames, once', () => {
    expect(FLASH_MS).toBe(2 * FRAME_MS);
    const rule = css.match(/\.win-flash \{([^}]*)\}/)[1];
    expect(rule).toMatch(/animation:\s*win-flash 220ms steps\(1\) 1;/);
  });

  test('YOU WIN! slams once on steps(6) and never blinks', () => {
    const rule = css.match(/\.win-title-text \{([^}]*)\}/)[1];
    expect(rule).toMatch(/animation:\s*win-slam 420ms steps\(6\) forwards/);
    expect(rule).not.toMatch(/infinite/);
    expect(rule).toMatch(/color:\s*#ffd23f/);
    // Only the opening sweeps and the one flash are keyframed flashes.
    expect(css.match(/@keyframes [\w-]+/g).sort()).toEqual([
      '@keyframes win-ball-bounce', '@keyframes win-bob', '@keyframes win-dive', '@keyframes win-endzone-in',
      '@keyframes win-flash', '@keyframes win-scroll', '@keyframes win-slam', '@keyframes win-sweep',
    ]);
  });

  test('the sweep lines are 2px pink then green', () => {
    expect(css.match(/\.win-sweep \{([^}]*)\}/)[1]).toMatch(/border-bottom:\s*2px/);
    expect(css.match(/\.win-sweep--pink \{([^}]*)\}/)[1]).toMatch(/#ff3fa4/);
    expect(css.match(/\.win-sweep--green \{([^}]*)\}/)[1]).toMatch(/#39ff88/);
    expect(css).toMatch(/win-sweep 500ms steps\(8\) forwards/);
  });

  test('sprites are 64px, 48px under a 420px viewport', () => {
    expect(css.match(/\.win-scene \{([^}]*)\}/)[1]).toMatch(/--win-sprite:\s*64px/);
    expect(css).toMatch(/@media \(max-width: 419px\) \{\s*\.win-scene \{ --win-sprite: 48px; \}/);
  });

  test('every new color literal is allowlisted for the color guard', () => {
    const guard = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'scripts', 'check-color-literals.js'), 'utf8');
    expect(guard).toContain("'src/features/postgame-cutscene/ui/WinScene.css'");
    expect(guard).toContain("'src/features/postgame-cutscene/ui/sprites.js'");
  });
});

describe('sprites', () => {
  test('each player frame is 16x16 in the role letters; the ball is 6x4', () => {
    [DIVE, SPIKE, ...DANCE].forEach((rows) => {
      expect(rows).toHaveLength(16);
      rows.forEach((row) => expect(row).toMatch(/^[.HJPASFB]{16}$/));
    });
    expect(BALL).toHaveLength(4);
    BALL.forEach((row) => expect(row).toMatch(/^[.OL]{6}$/));
  });

  test('the frames differ and take their colors from the kit', () => {
    expect(new Set([DIVE, SPIKE, ...DANCE].map((rows) => rows.join('|'))).size).toBe(5);
    const kit = {
      helmet: '#111111', jersey: '#222222', pants: '#333333', accent: '#444444',
    };
    const fills = frameRects(DANCE_A, kit).map((r) => r.fill);
    ['#111111', '#222222', '#333333', '#444444'].forEach((color) => expect(fills).toContain(color));
  });
});
