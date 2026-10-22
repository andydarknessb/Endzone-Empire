import {
  lineupIssues, lineupNote, lineupSlots, nextKickoff,
} from './lineupNote';

const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-10-18T19:40:00Z').getTime();
const player = (over = {}) => ({
  id: 1, name: 'P. Nacua', nfl_team: 'LAR', injury_status: null, game_state: 'scheduled', ...over,
});
const slotsOf = (players) => players.map((player_, i) => ({ slot: ['WR', 'FLEX'][i], player: player_ }));
const BENCH_OK = [player({ id: 5, name: 'Bench Runner', availability: { available: true, reason: null } })];

describe('lineupSlots', () => {
  test('reads the first side of paired rows when it is the viewer, null for an empty slot, nothing otherwise', () => {
    const rows = [{ slot: 'WR', first: player(), second: null }, { slot: 'FLEX', first: null, second: player({ id: 2 }) }];
    expect(lineupSlots(rows, true)).toEqual([{ slot: 'WR', player: rows[0].first }, { slot: 'FLEX', player: null }]);
    expect(lineupSlots(rows, false)).toEqual([]);
  });
});

describe('nextKickoff', () => {
  test('is the earliest kickoff still to come, from kickoff_at or start_time, and null with none', () => {
    const later = '2026-10-18T22:25:00Z';
    const sooner = '2026-10-18T20:25:00Z';
    expect(nextKickoff([
      { game_status: 'scheduled', kickoff_at: later },
      { game_status: 'scheduled', start_time: sooner },
      { game_status: 'in_progress', start_time: '2026-10-18T17:00:00Z' },
      { game_status: 'final', kickoff_at: '2026-10-15T00:20:00Z' },
    ])).toBe(new Date(sooner).getTime());
    expect(nextKickoff([{ game_status: 'final' }])).toBeNull();
    expect(nextKickoff(null)).toBeNull();
  });
});

describe('lineupIssues', () => {
  test('names an empty slot and a not-yet-started Out starter, in slot order', () => {
    expect(lineupIssues(slotsOf([player({ injury_status: 'O' }), null]))).toEqual([
      { slot: 'WR', kind: 'out', name: 'P. Nacua' },
      { slot: 'FLEX', kind: 'empty' },
    ]);
  });

  test('an Out starter whose game has started or finished is locked in, so it is no problem anyone can fix', () => {
    expect(lineupIssues(slotsOf([player({ injury_status: 'O', game_state: 'in_progress' }), player({ id: 2, injury_status: 'O', game_state: 'final' })]))).toEqual([]);
  });

  test('a game row for his NFL team beats his own state', () => {
    const rows = [{ away_team: 'LAR', home_team: 'JAX', game_status: 'in_progress' }];
    expect(lineupIssues(slotsOf([player({ injury_status: 'O', game_state: 'scheduled' })]), rows)).toEqual([]);
  });

  test('reads the availability verdict as well as the injury code', () => {
    expect(lineupIssues(slotsOf([player({ availability: { available: false, reason: 'out' } })]))).toHaveLength(1);
  });

  test('a clean lineup has none', () => {
    expect(lineupIssues(slotsOf([player(), player({ id: 2 })]))).toEqual([]);
  });
});

describe('lineupNote', () => {
  const base = { slots: slotsOf([player(), null]), bench: BENCH_OK, now: NOW };

  test('is null with nothing to fix', () => {
    expect(lineupNote({ ...base, slots: slotsOf([player(), player({ id: 2 })]), started: true, lockAt: NOW + 3 * HOUR })).toBeNull();
  });

  test('live, a bench player can fill it: "{SLOT} is empty · next kickoff {lock}" with the Set lineup link', () => {
    const note = lineupNote({ ...base, started: true, lockAt: NOW + 2 * HOUR });
    expect(note.kind).toBe('live');
    expect(note.plain).toMatch(/^FLEX is empty · next kickoff \w{3} /);
    expect(note.plain).not.toMatch(/fill it by/);
    expect(note.link).toBe('lineup');
    expect(note.danger).toBe(false);
    expect(note.segments[0]).toEqual({ text: 'FLEX is empty', strong: true });
  });

  test('live, under an hour: "next kickoff in {n} min" in Danger, the minutes rounded up', () => {
    const note = lineupNote({ ...base, started: true, lockAt: NOW + 44 * 60 * 1000 + 30 * 1000 });
    expect(note.plain).toBe('FLEX is empty · next kickoff in 45 min');
    expect(note.danger).toBe(true);
    expect(note.segments.find((s) => s.danger).text).toBe('next kickoff in 45 min');
  });

  test('live, no bench player can fill it: says so and points at free agents, with the timing in Danger under an hour', () => {
    const note = lineupNote({
      ...base, bench: [player({ game_state: 'in_progress' })], started: true, lockAt: NOW + 45 * 60 * 1000,
    });
    expect(note.link).toBe('free-agents');
    expect(note.plain).toMatch(/^FLEX is empty · no bench player can fill it · add a free agent playing at .+ · next kickoff in 45 min$/);
    expect(note.segments.find((s) => s.danger).text).toBe('next kickoff in 45 min');
  });

  test('further out the free-agent line carries no countdown', () => {
    const note = lineupNote({
      ...base, bench: [], started: true, lockAt: NOW + 3 * HOUR,
    });
    expect(note.link).toBe('free-agents');
    expect(note.plain).not.toMatch(/next kickoff in/);
    expect(note.danger).toBe(false);
  });

  test('an Out bench player, one on bye and one whose game has started cannot fill it either', () => {
    const live = { ...base, started: true, lockAt: NOW + 2 * HOUR };
    expect(lineupNote({ ...live, bench: [player({ injury_status: 'O' })] }).link).toBe('free-agents');
    expect(lineupNote({ ...live, bench: [player({ availability: { available: false, reason: 'bye' } })] }).link).toBe('free-agents');
    expect(lineupNote({ ...live, bench: [player()], gameStates: [{ away_team: 'LAR', home_team: 'JAX', game_status: 'in_progress' }] }).link).toBe('free-agents');
  });

  describe('who can fill the slot (the roster template decides)', () => {
    const FLEX = [{ key: 'FLEX', eligiblePositions: ['RB', 'WR', 'TE'] }];
    const SUPERFLEX = [{ key: 'FLEX', eligiblePositions: ['QB', 'RB', 'WR', 'TE'] }];
    const live = { ...base, started: true, lockAt: NOW + 2 * HOUR };

    test('a bench of only a K and a DEF cannot fill a FLEX: no bench player can fill it, Free agents', () => {
      const note = lineupNote({ ...live, template: FLEX, bench: [player({ id: 6, position: 'K' }), player({ id: 7, position: 'DEF' })] });
      expect(note.plain).toMatch(/^FLEX is empty · no bench player can fill it/);
      expect(note.link).toBe('free-agents');
    });

    test('a superflex takes a bench QB; a plain FLEX does not', () => {
      const bench = [player({ id: 6, position: 'QB' })];
      expect(lineupNote({ ...live, template: SUPERFLEX, bench }).link).toBe('lineup');
      expect(lineupNote({ ...live, template: FLEX, bench }).link).toBe('free-agents');
    });

    test('a bench RB fills the FLEX, and a template that lists no eligibility cannot rule him out', () => {
      const bench = [player({ id: 6, position: 'RB' })];
      expect(lineupNote({ ...live, template: FLEX, bench }).link).toBe('lineup');
      expect(lineupNote({ ...live, template: [{ key: 'FLEX' }], bench: [player({ id: 6, position: 'K' })] }).link).toBe('lineup');
      expect(lineupNote({ ...live, bench: [player({ id: 6, position: 'K' })] }).link).toBe('lineup');
    });

    test('a bench player with no known game state is not started, so he does not force the Free agents branch', () => {
      const bench = [player({ id: 6, position: 'RB', game_state: null })];
      expect(lineupNote({ ...live, template: FLEX, bench }).link).toBe('lineup');
    });

    test('a game row that says his game has started rules him out, whatever his own state says', () => {
      const bench = [player({ id: 6, position: 'RB', nfl_team: 'SF', game_state: 'scheduled' })];
      const gameStates = [{ away_team: 'ARI', home_team: 'SF', game_status: 'in_progress' }];
      expect(lineupNote({ ...live, template: FLEX, bench, gameStates }).link).toBe('free-agents');
    });
  });

  test('the lock defaults to the next kickoff among the game states', () => {
    const kick = new Date(NOW + 2 * HOUR).toISOString();
    const note = lineupNote({ ...base, started: true, gameStates: [{ game_status: 'scheduled', home_team: 'SF', away_team: 'ARI', start_time: kick }] });
    expect(note.plain).toMatch(/^FLEX is empty · next kickoff /);
    expect(lineupNote({ ...base, started: true, gameStates: [] })).toBeNull();
  });

  test('live with no lock still to come leaves nothing to fix', () => {
    expect(lineupNote({ ...base, started: true, lockAt: null })).toBeNull();
    expect(lineupNote({ ...base, started: true, lockAt: NOW - 1 })).toBeNull();
  });

  test('live, an Out starter in a later game is named by his slot', () => {
    const note = lineupNote({ ...base, slots: slotsOf([player({ injury_status: 'O' }), player({ id: 2 })]), started: true, lockAt: NOW + 2 * HOUR });
    expect(note.plain).toMatch(/^WR holds P\. Nacua \(Out\) · next kickoff /);
  });

  test('before kickoff: the advice sentence, the outlook from the Proj figures and the gain, and the lock on its own line', () => {
    const note = lineupNote({
      ...base,
      started: false,
      lockAt: NOW + 15 * HOUR,
      advice: 'Two moves · +23.0 pts: Addison in for Puka Nacua (Out) · Spears into the empty FLEX',
      gain: 23,
      proj: { you: 93.8, them: 98.6 },
    });
    expect(note.kind).toBe('pre');
    expect(note.segments[0].text).toBe("Two moves · +23.0 pts: Addison in for Puka Nacua (Out) · Spears into the empty FLEX · you'd project 116.8 to 98.6");
    expect(note.sub).toMatch(/^Locks /);
    expect(note.link).toBe('lineup');
    expect(note.danger).toBe(false);
  });

  test('before kickoff with no advice yet: the problems themselves, and no outlook without a gain', () => {
    const note = lineupNote({
      ...base, slots: slotsOf([player({ injury_status: 'O' }), null]), started: false, lockAt: null, proj: { you: 93.8, them: 98.6 },
    });
    expect(note.segments[0].text).toBe('P. Nacua (Out) at WR · FLEX is empty');
    expect(note.sub).toBeNull();
  });
});

describe('a display label apart from the slot key', () => {
  const NOW_ = new Date('2026-10-18T19:40:00Z').getTime();
  const slots = [{ slot: 'WR', label: 'WR 2', player: null }];
  const bench = [{ id: 5, name: 'Bench Runner', position: 'WR', nfl_team: 'DAL', availability: { available: true, reason: null } }];

  test('the note names the seat by its label', () => {
    const note = lineupNote({ slots, bench, now: NOW_, started: true, lockAt: NOW_ + 3 * HOUR });
    expect(note.plain).toMatch(/^WR 2 is empty · next kickoff/);
    expect(lineupIssues(slots)).toEqual([{ slot: 'WR', kind: 'empty', label: 'WR 2' }]);
  });

  test('the slot key, not the label, decides who can fill it', () => {
    const template = [{ key: 'WR', eligiblePositions: ['WR'] }];
    const kicker = [{ id: 6, name: 'K', position: 'K', nfl_team: 'DAL', availability: { available: true, reason: null } }];
    const note = lineupNote({ slots, bench: kicker, template, now: NOW_, started: true, lockAt: NOW_ + 3 * HOUR });
    expect(note.link).toBe('free-agents');
    expect(note.plain).toMatch(/^WR 2 is empty · no bench player can fill it/);
  });

  test('without a label it says the key, as before', () => {
    expect(lineupNote({ slots: [{ slot: 'FLEX', player: null }], bench, now: NOW_, started: true, lockAt: NOW_ + 3 * HOUR }).plain).toMatch(/^FLEX is empty/);
  });
});
