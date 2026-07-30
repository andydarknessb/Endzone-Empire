'use strict';

/**
 * The deterministic production-order reconstruction.
 *
 * Production feeds its optimizer candidates in `ORDER BY position, name`
 * (`lineup.service.js:217`), and the optimizer resolves equal costs by CANDIDATE
 * COLUMN ORDER (`lineupOptimizer.js:74` - the strict `<` means an earlier
 * column wins a tie). So candidate order is not cosmetic: it decides which of
 * two equally-projected players starts, and therefore what regret the study
 * measures.
 *
 * That order cannot be reproduced exactly, and the preregistration says so
 * plainly (5.2): `ORDER BY position, name` is neither TOTAL - duplicate names
 * are left unordered - nor PORTABLE, because name order follows the production
 * PostgreSQL collation rather than any JS comparator. What this module builds
 * is therefore a DETERMINISTIC RECONSTRUCTION, explicitly not claimed to be
 * production semantics, resting on two artifacts captured from the database
 * itself inside the read-only extraction transaction:
 *
 *   1. the position-code ordering of the closed week-position code set;
 *   2. the `(name, id)` ordering over all players.
 *
 * Composition, in order:
 *
 *   - **reconstructed roster-week position FIRST**, mapped through artifact 1.
 *     This is what makes today's `players.position` unable to affect historical
 *     candidate order: a player who is a WR today but was an RB in the week
 *     being evaluated sorts as an RB, because the position comes from the
 *     roster file and only the RANK of that code comes from the database.
 *   - **captured name rank second**, from artifact 2 - PostgreSQL's own
 *     collation, never `Intl.Collator` and never a JS string comparison.
 *   - **player id third**, the documented refinement that makes the order
 *     total where production's is not.
 *
 * **Fail closed if an evaluated player lacks a rank.** An unranked player would
 * sort arbitrarily, and removing arbitrariness is the entire reason the
 * artifacts were captured.
 *
 * Pure: no database, no clock, no locale.
 */

/**
 * The two sensitivities the preregistration requires (5.2), plus the primary.
 *
 * If either sensitivity changes a winner or a pass verdict, that result is
 * INCONCLUSIVE - see `orderingSensitivityVerdict`.
 */
const ORDERINGS = Object.freeze({
  /** Position rank, then captured name rank, then id. The primary. */
  PRIMARY: 'primary',
  /**
   * The DB-collation variant: name rank FIRST, ignoring position. Production's
   * `ORDER BY position, name` puts position first, so this is a deliberate
   * departure whose only purpose is to show the answer does not depend on it.
   */
  DB_COLLATION: 'db-collation',
  /**
   * Duplicate-order shuffle: players who tie through name rank - the case
   * production leaves genuinely unordered - are permuted by a seeded shuffle.
   * Everything production DOES order stays put.
   */
  DUPLICATE_SHUFFLE: 'duplicate-shuffle',
});
const ORDERING_NAMES = Object.freeze(Object.values(ORDERINGS));

/**
 * Build the rank lookup a candidate comparator needs.
 *
 * `positionRank` maps a week-position CODE to its captured rank; `nameRankById`
 * maps a database player id to its captured `(name, id)` rank. Both come from
 * the extraction, and both are hashed into freeze manifest B.
 */
function buildRankIndex({ positionRankRows, playerNameRankRows, label = 'ordering' }) {
  const positionRank = new Map();
  for (const row of positionRankRows || []) {
    const code = String(row.code);
    if (positionRank.has(code)) throw new Error(`${label}: duplicate position rank for ${code}`);
    positionRank.set(code, Number(row.rank));
  }
  const nameRankById = new Map();
  for (const row of playerNameRankRows || []) {
    const id = Number(row.id);
    if (nameRankById.has(id)) throw new Error(`${label}: duplicate name rank for player ${id}`);
    nameRankById.set(id, Number(row.rank));
  }
  if (positionRank.size === 0) throw new Error(`${label}: the position-rank artifact is empty`);
  if (nameRankById.size === 0) throw new Error(`${label}: the name-rank artifact is empty`);
  return { positionRank, nameRankById };
}

/**
 * Pure: the sort key for one candidate. Throws if any component is missing.
 *
 * `position` is the RECONSTRUCTED roster-week position, not today's. That is
 * the whole point of taking it as an argument rather than reading it off a
 * players row.
 */
function candidateKey({ candidate, ranks, label = 'ordering' }) {
  const position = candidate.position;
  const positionRank = ranks.positionRank.get(String(position));
  if (positionRank === undefined) {
    throw new Error(
      `${label}: week-position ${JSON.stringify(position)} has no captured rank. The position-code ` +
      'ordering is a database collation artifact and every evaluated position must appear in it.'
    );
  }
  const playerId = candidate.playerId;
  if (playerId === null || playerId === undefined) {
    throw new Error(
      `${label}: candidate ${JSON.stringify(candidate.teamKey ?? candidate.name ?? '?')} has no ` +
      'player id, so it cannot carry a captured name rank. A synthesized defence must borrow the ' +
      'database DEF row\'s identity before it reaches the wrapper.'
    );
  }
  const nameRank = ranks.nameRankById.get(Number(playerId));
  if (nameRank === undefined) {
    throw new Error(
      `${label}: player ${playerId} has no captured name rank, so candidate order would be ` +
      'arbitrary. The preregistration fails closed here rather than guessing an order.'
    );
  }
  return { positionRank, nameRank, playerId: Number(playerId) };
}

/** Pure: a deterministic 32-bit PRNG, so the shuffle sensitivity needs no global RNG. */
function makeRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Order candidates for the optimizer.
 *
 * Returns a NEW array; the input is never mutated, because the caller's roster
 * order is itself an artifact and reordering it in place would be a silent
 * change to something committed.
 */
function orderCandidates({
  candidates, ranks, ordering = ORDERINGS.PRIMARY, shuffleSeed = 1, label = 'ordering',
}) {
  if (!ORDERING_NAMES.includes(ordering)) {
    throw new Error(`${label}: unknown ordering ${JSON.stringify(ordering)}`);
  }
  const keyed = candidates.map((candidate) => ({
    candidate,
    key: candidateKey({ candidate, ranks, label }),
  }));

  if (ordering === ORDERINGS.DB_COLLATION) {
    // Name rank first, position ignored: the variant that shows the answer does
    // not depend on production's position-first ordering.
    keyed.sort((a, b) => a.key.nameRank - b.key.nameRank || a.key.playerId - b.key.playerId);
    return keyed.map((k) => k.candidate);
  }

  keyed.sort((a, b) => a.key.positionRank - b.key.positionRank
    || a.key.nameRank - b.key.nameRank
    || a.key.playerId - b.key.playerId);

  if (ordering === ORDERINGS.DUPLICATE_SHUFFLE) {
    // Permute ONLY the runs production leaves unordered - players sharing a
    // name rank. Everything production does order stays exactly where it is, so
    // this isolates the one degree of freedom the reconstruction invented.
    const rng = makeRng(shuffleSeed);
    let start = 0;
    for (let i = 1; i <= keyed.length; i++) {
      const sameRun = i < keyed.length
        && keyed[i].key.positionRank === keyed[start].key.positionRank
        && keyed[i].key.nameRank === keyed[start].key.nameRank;
      if (sameRun) continue;
      for (let j = i - 1; j > start; j--) {
        const k = start + Math.floor(rng() * (j - start + 1));
        [keyed[j], keyed[k]] = [keyed[k], keyed[j]];
      }
      start = i;
    }
  }
  return keyed.map((k) => k.candidate);
}

/**
 * Pure: how many candidates share a `(positionRank, nameRank)` pair - i.e. how
 * much of the order the reconstruction had to invent.
 *
 * Published so a reader can see whether the shuffle sensitivity had anything to
 * shuffle. A sensitivity over zero duplicate pairs is vacuously stable, and
 * saying so is more honest than reporting "the shuffle changed nothing".
 */
function duplicateOrderCount({ candidates, ranks, label = 'ordering' }) {
  const seen = new Map();
  let duplicates = 0;
  for (const candidate of candidates) {
    const key = candidateKey({ candidate, ranks, label });
    const id = `${key.positionRank}:${key.nameRank}`;
    const count = (seen.get(id) || 0) + 1;
    seen.set(id, count);
    if (count > 1) duplicates++;
  }
  return { duplicates, distinctKeys: seen.size, candidates: candidates.length };
}

/**
 * The preregistration's interpretation rule, as a function (5.2): **if ordering
 * changes any winner or any pass verdict, that result is INCONCLUSIVE.**
 *
 * Takes the primary result and the two sensitivity results and returns a
 * verdict. It deliberately does NOT try to decide which ordering is "right" -
 * that is the point. A result that depends on an ordering the study had to
 * invent is not a result.
 */
function orderingSensitivityVerdict({ primary, sensitivities, label = 'ordering sensitivity' }) {
  if (!primary || typeof primary !== 'object') {
    throw new Error(`${label}: the primary result is required`);
  }
  const entries = Object.entries(sensitivities || {});
  if (entries.length === 0) {
    // A sensitivity that was never run cannot show stability. Missing is not
    // passing, here as everywhere else in this study.
    throw new Error(
      `${label}: no sensitivity results supplied. The DB-collation variant and the duplicate-order ` +
      'shuffle are both REQUIRED, and a missing one cannot demonstrate that ordering did not matter.'
    );
  }
  const disagreements = [];
  for (const [name, result] of entries) {
    if (!result || typeof result !== 'object') {
      throw new Error(`${label}: sensitivity ${name} produced no result`);
    }
    if (result.winner !== primary.winner) {
      disagreements.push(`${name}: winner ${JSON.stringify(result.winner)} vs primary ${JSON.stringify(primary.winner)}`);
    }
    if (result.verdict !== primary.verdict) {
      disagreements.push(`${name}: verdict ${JSON.stringify(result.verdict)} vs primary ${JSON.stringify(primary.verdict)}`);
    }
  }
  if (disagreements.length > 0) {
    return {
      verdict: 'inconclusive',
      reason: 'ordering-dependent',
      detail:
        'the result changes with candidate ordering, which the reconstruction had to invent where '
        + `production leaves it unspecified (${disagreements.join('; ')})`,
      disagreements,
    };
  }
  return {
    verdict: primary.verdict,
    reason: null,
    detail: `stable across ${entries.length} ordering sensitivit${entries.length === 1 ? 'y' : 'ies'}`,
    disagreements: [],
  };
}

module.exports = {
  ORDERINGS,
  ORDERING_NAMES,
  buildRankIndex,
  candidateKey,
  makeRng,
  orderCandidates,
  duplicateOrderCount,
  orderingSensitivityVerdict,
};
