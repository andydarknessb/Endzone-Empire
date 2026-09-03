import { createLineGenerator, fillTemplate } from './lineFor';
import { LINES } from './voices/polkHighLegend';
import { TRIGGERS } from './triggers';
import { mulberry32 } from '../draftSim/rng';

describe('fillTemplate', () => {
  it('fills the {player}/{position}/{team} aliases from the facts.player shape', () => {
    const facts = {
      player: { name: 'Test Back', position: 'RB', nfl_team: 'KC', injury_status: 'Questionable' },
    };
    expect(fillTemplate('{player} plays {position} for {team}', facts))
      .toBe('Test Back plays RB for KC');
  });

  it('fills top-level fields directly', () => {
    expect(fillTemplate('pick {pickNumber}, round {round}', { pickNumber: 5, round: 1 }))
      .toBe('pick 5, round 1');
  });

  it('renders a missing value as empty rather than "undefined"', () => {
    expect(fillTemplate('{player} is here', {})).toBe(' is here');
  });
});

describe('createLineGenerator / lineFor', () => {
  const FACTS = { trigger: TRIGGERS.PICK_GENERIC, player: { name: 'Test Player' }, pickNumber: 3, round: 1 };

  it('never repeats text for a trigger within a draft until the pool is exhausted', () => {
    const lineFor = createLineGenerator();
    const rng = mulberry32(12345);
    const poolSize = LINES[TRIGGERS.PICK_GENERIC].length;
    expect(poolSize).toBeGreaterThanOrEqual(6);

    const seen = new Set();
    for (let i = 0; i < poolSize; i++) {
      const { text, trigger } = lineFor(FACTS, rng);
      expect(trigger).toBe(TRIGGERS.PICK_GENERIC);
      expect(seen.has(text)).toBe(false);
      seen.add(text);
    }
    expect(seen.size).toBe(poolSize);
  });

  it('resets the pool once exhausted, so the trigger can draw again', () => {
    const lineFor = createLineGenerator();
    const rng = mulberry32(999);
    const poolSize = LINES[TRIGGERS.PICK_GENERIC].length;
    const knownTexts = new Set(LINES[TRIGGERS.PICK_GENERIC].map((t) => fillTemplate(t, FACTS)));

    // Exhaust the pool.
    for (let i = 0; i < poolSize; i++) lineFor(FACTS, rng);

    // The very next draw must succeed (not null/empty) and land back inside
    // the same known set of texts, proving the "used" tracker reset rather
    // than the trigger going permanently silent.
    const after = lineFor(FACTS, rng);
    expect(after).not.toBeNull();
    expect(knownTexts.has(after.text)).toBe(true);

    // And a full second lap can again cover the whole pool without a gap.
    const secondLap = new Set([after.text]);
    for (let i = 0; i < poolSize - 1; i++) secondLap.add(lineFor(FACTS, rng).text);
    expect(secondLap.size).toBe(poolSize);
  });

  it('is deterministic for a fixed seed', () => {
    const rngA = mulberry32(42);
    const rngB = mulberry32(42);
    const a = createLineGenerator();
    const b = createLineGenerator();
    const sequenceA = Array.from({ length: 6 }, () => a(FACTS, rngA).text);
    const sequenceB = Array.from({ length: 6 }, () => b(FACTS, rngB).text);
    expect(sequenceA).toEqual(sequenceB);
  });

  it('tracks each trigger independently, one pool per trigger', () => {
    const lineFor = createLineGenerator();
    const rng = mulberry32(7);
    const stealFacts = { ...FACTS, trigger: TRIGGERS.PICK_STEAL };
    const reachFacts = { ...FACTS, trigger: TRIGGERS.PICK_REACH };
    const stealPoolSize = LINES[TRIGGERS.PICK_STEAL].length;

    // Fully exhausting PICK_STEAL must not disturb PICK_REACH's own pool.
    for (let i = 0; i < stealPoolSize; i++) lineFor(stealFacts, rng);
    const reachSeen = new Set();
    for (let i = 0; i < LINES[TRIGGERS.PICK_REACH].length; i++) {
      reachSeen.add(lineFor(reachFacts, rng).text);
    }
    expect(reachSeen.size).toBe(LINES[TRIGGERS.PICK_REACH].length);
  });

  it('returns null for a trigger with no configured lines', () => {
    const lineFor = createLineGenerator({});
    expect(lineFor(FACTS, mulberry32(1))).toBeNull();
  });

  it('accepts an injected line table so a voice can be swapped in tests', () => {
    const lineFor = createLineGenerator({ [TRIGGERS.PICK_GENERIC]: ['only one line'] });
    const rng = mulberry32(1);
    const first = lineFor(FACTS, rng);
    const second = lineFor(FACTS, rng);
    expect(first.text).toBe('only one line');
    expect(second.text).toBe('only one line');
  });
});
