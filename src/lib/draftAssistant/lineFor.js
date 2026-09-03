import { LINES } from './voices/polkHighLegend';

/** Dot-path lookup: get(facts, 'player.name') -> facts.player.name, undefined-safe. */
function get(obj, path) {
  return path.split('.').reduce((node, key) => (node == null ? undefined : node[key]), obj);
}

// Convenience aliases over the facts shape (see index.js's docblock) so the
// copy table can write the common cases as {player}/{position}/{team}
// instead of the fully qualified {player.name}/{player.position}/etc.
export const PLACEHOLDER_ALIASES = {
  player: 'player.name',
  position: 'player.position',
  team: 'player.nfl_team',
  injuryStatus: 'player.injury_status',
};

// Top-level facts fields the copy table is allowed to reference directly
// (i.e. not through an alias above). Exported alongside PLACEHOLDER_ALIASES
// so polkHighLegend.test.js can assert every {placeholder} actually used in
// the table is one or the other -- a typo'd or dropped key would otherwise
// only ever render as silent empty text (fillTemplate's designed fallback
// for a genuinely absent fact), never fail loudly.
export const KNOWN_DIRECT_KEYS = ['pickNumber', 'round', 'draftRounds', 'adp'];

/** Fills a template's {placeholder} slots from a facts object. A missing value renders empty. */
export function fillTemplate(template, facts) {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const path = PLACEHOLDER_ALIASES[key] || key;
    const value = get(facts, path);
    return value == null ? '' : String(value);
  });
}

/** Removes and returns one random element of `remaining` (mutates it), via rng(). */
function drawIndex(rng, remaining) {
  const i = Math.floor(rng() * remaining.length);
  return remaining.splice(i, 1)[0];
}

/**
 * Creates a per-draft line generator (ruling 2, issue #784): a
 * `lineFor(facts, rng)` function that closes over a used-index tracker per
 * trigger, so the SAME draft never shows a repeated line for a trigger until
 * every line in that trigger's pool has come up once. Once a trigger's pool
 * is exhausted the tracker resets and the trigger starts drawing from its
 * full pool again.
 *
 * The factory shape is what makes this per-draft rather than per-module: two
 * concurrent drafts (e.g. two open Sim tabs) each call createLineGenerator()
 * once and get their own independent "used" state, nothing shared at module
 * scope.
 *
 * `rng` is passed in per call, not created here, matching src/lib/draftSim's
 * mulberry32 shape: `() => number in [0, 1)`. The caller decides how the
 * generator is seeded (the Sim's persisted seed, a fresh one in the Draft
 * room) and lineFor() only ever consumes it.
 *
 * @param {object} [lines] the trigger -> template[] table (defaults to the
 *   Polk High Legend voice, the only voice this cut ships)
 * @returns {(facts: object, rng: () => number) => { trigger: string, text: string } | null}
 */
export function createLineGenerator(lines = LINES) {
  const remainingByTrigger = new Map();

  function remainingFor(trigger) {
    let remaining = remainingByTrigger.get(trigger);
    if (!remaining || remaining.length === 0) {
      const pool = lines[trigger] || [];
      remaining = pool.map((_, i) => i);
      remainingByTrigger.set(trigger, remaining);
    }
    return remaining;
  }

  return function lineFor(facts, rng) {
    const { trigger } = facts || {};
    const pool = lines[trigger] || [];
    if (pool.length === 0) return null;
    const remaining = remainingFor(trigger);
    const index = drawIndex(rng, remaining);
    return { trigger, text: fillTemplate(pool[index], facts) };
  };
}
