import { lineupIssues, lineupNoteView } from './lineupNoteView';

const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-10-18T19:40:00Z').getTime();
const player = (over = {}) => ({
  id: 1, name: 'P. Nacua', injury_status: null, game_state: 'scheduled', ...over,
});
const rows = (home) => home.map((h, i) => ({ slot: ['WR', 'FLEX'][i], home: h, away: player({ id: 90 + i }) }));
const BENCH_OK = [player({ id: 5, name: 'Bench Runner', availability: { available: true, reason: null } })];

describe('lineupIssues', () => {
  test('names an empty slot and a not-yet-started Out starter on the viewer side, in slot order', () => {
    expect(lineupIssues(rows([player({ injury_status: 'O' }), null]), 'home')).toEqual([
      { slot: 'WR', kind: 'out', name: 'P. Nacua' },
      { slot: 'FLEX', kind: 'empty' },
    ]);
  });

  test('an Out starter whose game has started or finished is locked in, so it is no problem anyone can fix', () => {
    expect(lineupIssues(rows([player({ injury_status: 'O', game_state: 'in_progress' }), player({ id: 2, injury_status: 'O', game_state: 'final' })]), 'home')).toEqual([]);
  });

  test('reads the availability verdict as well as the injury code', () => {
    expect(lineupIssues(rows([player({ availability: { available: false, reason: 'out' } })]), 'home')).toHaveLength(1);
  });

  test('a non-participant, or a clean lineup, has none', () => {
    expect(lineupIssues(rows([null]), null)).toEqual([]);
    expect(lineupIssues(rows([player(), player({ id: 2 })]), 'home')).toEqual([]);
  });
});

describe('lineupNoteView', () => {
  const base = {
    rows: rows([player(), null]), viewerSide: 'home', bench: BENCH_OK, now: NOW,
  };

  test('is null with nothing to fix', () => {
    expect(lineupNoteView({ ...base, rows: rows([player(), player({ id: 2 })]), started: true, lockAt: NOW + 3 * HOUR })).toBeNull();
  });

  test('live: "{SLOT} is empty · fill it by {lock}" with the Set lineup link', () => {
    const view = lineupNoteView({ ...base, started: true, lockAt: NOW + 2 * HOUR });
    expect(view.kind).toBe('live');
    expect(view.plain).toMatch(/^FLEX is empty · fill it by /);
    expect(view.cta).toBe('lineup');
    expect(view.urgent).toBe(false);
    expect(view.segments[0]).toEqual({ text: 'FLEX is empty', strong: true });
  });

  test('live, under an hour: "locks in {n} min" in Danger, the minutes rounded up', () => {
    const view = lineupNoteView({ ...base, started: true, lockAt: NOW + 44 * 60 * 1000 + 30 * 1000 });
    expect(view.plain).toBe('FLEX is empty · locks in 45 min');
    expect(view.urgent).toBe(true);
    expect(view.segments.find((s) => s.danger).text).toBe('locks in 45 min');
  });

  test('live, no bench player can fill it: says so and points at free agents, with the timing in Danger under an hour', () => {
    const view = lineupNoteView({
      ...base, bench: [player({ game_state: 'in_progress' })], started: true, lockAt: NOW + 45 * 60 * 1000,
    });
    expect(view.cta).toBe('free-agents');
    expect(view.plain).toMatch(/^FLEX is empty · no bench player can fill it · add a free agent playing at .+ · next kickoff in 45 min$/);
    expect(view.segments.find((s) => s.danger).text).toBe('next kickoff in 45 min');
  });

  test('live, an Out bench player or one on bye cannot fill it either', () => {
    expect(lineupNoteView({ ...base, bench: [player({ injury_status: 'O' })], started: true, lockAt: NOW + 2 * HOUR }).cta).toBe('free-agents');
    expect(lineupNoteView({ ...base, bench: [player({ availability: { available: false, reason: 'bye' } })], started: true, lockAt: NOW + 2 * HOUR }).cta).toBe('free-agents');
  });

  test('live with no lock still to come leaves nothing to fix', () => {
    expect(lineupNoteView({ ...base, started: true, lockAt: null })).toBeNull();
    expect(lineupNoteView({ ...base, started: true, lockAt: NOW - 1 })).toBeNull();
  });

  test('live, an Out starter in a later game is named by his slot', () => {
    const view = lineupNoteView({ ...base, rows: rows([player({ injury_status: 'O' }), player({ id: 2 })]), started: true, lockAt: NOW + 2 * HOUR });
    expect(view.plain).toMatch(/^WR holds P\. Nacua \(Out\) · fill it by /);
  });

  test('before kickoff: the advice sentence, the outlook from the Proj figures and the gain, and the lock on its own line', () => {
    const view = lineupNoteView({
      ...base,
      started: false,
      lockAt: NOW + 15 * HOUR,
      advice: 'Two moves · +23.0 pts: Addison in for Puka Nacua (Out) · Spears into the empty FLEX',
      gain: 23,
      proj: { you: 93.8, them: 98.6 },
    });
    expect(view.kind).toBe('pre');
    expect(view.segments[0].text).toBe("Two moves · +23.0 pts: Addison in for Puka Nacua (Out) · Spears into the empty FLEX · you'd project 116.8 to 98.6");
    expect(view.sub).toMatch(/^Locks /);
    expect(view.cta).toBe('lineup');
  });

  test('before kickoff with no advice yet: the problems themselves, and no outlook without a gain', () => {
    const view = lineupNoteView({
      ...base, rows: rows([player({ injury_status: 'O' }), null]), started: false, lockAt: null, proj: { you: 93.8, them: 98.6 },
    });
    expect(view.segments[0].text).toBe('P. Nacua (Out) at WR · FLEX is empty');
    expect(view.sub).toBeNull();
  });
});
