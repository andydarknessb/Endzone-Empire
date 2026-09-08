const { optimalLineup, parseLineupSettings } = require('./lineup.service');

/*
 * The FORMAT and the SUMMING RULE for a week's counted roster.
 *
 * The POPULATION - which of the week's lineup rows count as played - is owned
 * by `rowsHeldAsPlayed` in lineup.service (the tenure predicate, #228; the
 * last-kickoff bound best ball adds, #635/ADR 0022). This module owns
 * everything that happens AFTER that read: the IR classification, the
 * started-total test, the pricing loop, the ordering of the excluded rows and
 * the rounding. It is pure - no database, no clock - and takes rows that were
 * already fetched and already held-as-played, so a caller reads the population
 * once and then hands the rows here.
 *
 * Before #954 this rule was copied at the sites that price a counted roster.
 * I enumerated them at HEAD by grepping `rowsHeldAsPlayed(` across the server
 * (the population read every counted-roster site goes through) and by reading
 * each `optimalLineup(`/`parseLineupSettings(` hit. Three price its result and
 * now call this module:
 *   - scoring.service `teamScore`, best-ball branch (the settle pass);
 *   - scoring.service `teamScore`, standard branch (the settle pass);
 *   - decision.service `weekHindsight`.
 * A FOURTH genuine as-played derivation exists and is deliberately NOT
 * converted here: league.router `buildTeam`, the `best_ball && asPlayed`
 * branch (PR #1031 / #1006, landed after this extraction began). It runs the
 * same optimalLineup/parseLineupSettings pair inline over the as-played rows
 * to split a settled best-ball card into starters and bench. It keys rows on
 * `row.id` (not `player_id`) and coalesces a statless row to 0, so folding it
 * in needs a small adapter and is its own ticket, not #954; follow-up #1038
 * tracks it. By the governing ruling's criterion (reads the counted roster
 * with the tenure exclusion applied) there are FOUR such sites: the three
 * above plus this one. The ruling (issuecomment-5563961587) had already
 * replaced the issue body's "five implementations" with those three;
 * league.router's box score was excluded then for carrying no tenure
 * exclusion, and #976/#1020 have since put that read behind rowsHeldAsPlayed,
 * which is what turns the #1006 branch into a genuine fourth.
 * Three further reads take a lineup population WITHOUT the tenure exclusion -
 * the live/current-roster question, not this one - and are not counted-roster
 * sites at all: decision.service `liveWhatIf`, expectedFinal.service, and the
 * matchup box-score reader in league.router. Folding any in would change
 * behaviour. (#1010 tracks the join drift the settle sites carry.)
 *
 * The two settle branches feed DIFFERENT rows on purpose, and this module does
 * not reconcile them (#1010): the standard branch's SQL inner-joins
 * player_stats and so drops a statless starter from the row set entirely, while
 * best ball and hindsight left-join and keep him priced at zero. The team total
 * is the same either way; only the row COUNT differs. Rows arrive as given -
 * this module never filters a statless row nor synthesises a zero-stat one.
 *
 * IR is excluded here in JS for the best-ball settle branch and for hindsight,
 * which both select every slot. The standard settle branch instead excludes IR
 * (and BENCH) in its SQL and never sends an IR row here; that SQL clause is load
 * bearing for a fixture guard (#954 criterion 4) and stays where it is. So an
 * IR row reaching this module is dropped once, by the classification below; a
 * standard-branch row never reaches it as IR in the first place.
 */

const IR = 'IR';
const BENCH = 'BENCH';

function round2(x) {
  return Math.round(Number(x) * 100) / 100;
}

/**
 * Price and summarise a team's counted roster for one week.
 *
 * @param {object}   args
 * @param {Array}    args.rows    the held-as-played lineup rows, as fetched:
 *                                each `{ player_id, slot, stats, position?, name? }`.
 *                                `position` feeds the optimal lineup, which is
 *                                COMPUTED on every call. Only best ball and
 *                                hindsight READ that result, and only they
 *                                supply `position`; the standard settle branch
 *                                selects none (its SQL already narrowed the rows
 *                                to starters), so the optimal lineup it computes
 *                                is empty and discarded, and only `teamScore` is
 *                                meaningful for that caller. `name` is carried
 *                                through to `optimalStarters`.
 * @param {object}   args.league  the league row; `best_ball` and the roster
 *                                slots (via parseLineupSettings) are read.
 * @param {function} args.price   `(stats) => points`, the league's pricer. Kept
 *                                as a parameter rather than imported so this
 *                                module does not depend on scoring.service,
 *                                which depends on it.
 * @returns {{
 *   counted: Array, excluded: Array, teamScore: number,
 *   startedPoints: number, optimalPoints: number,
 *   optimalStarters: Array, pointsLeftOnBench: number
 * }}
 *   `teamScore` is the score of record for this team: best ball scores its
 *   optimal lineup over the whole held pool; a standard league scores only the
 *   rows in a starting slot. `excluded` lists the IR rows dropped, in input
 *   order. Hindsight reads every field; the settle pass reads `teamScore`.
 *   `optimalPoints`, `optimalStarters` and `pointsLeftOnBench` are meaningful
 *   only for a caller that supplies `position` (best ball and hindsight); for
 *   the standard settle branch, which supplies none, they are the empty-lineup
 *   values (0 / [] / 0) and must not be read - only `teamScore` is.
 */
function countedRoster({ rows, league, price }) {
  const bestBall = !!league.best_ball;
  const { rosterSlots } = parseLineupSettings(league);

  // IR classification, preserving input order in both partitions. An IR
  // occupant is never a candidate starter in any league type (#741) and never
  // counted toward the started total.
  const counted = [];
  const excluded = [];
  for (const row of rows) {
    if (row.slot === IR) {
      excluded.push({ playerId: row.player_id, slot: row.slot, reason: IR });
      continue;
    }
    counted.push(row);
  }

  // The pricing loop. Built once over the counted rows and reused for both the
  // started total and the optimal lineup, so the two can never price a row two
  // different ways.
  const pointsFor = new Map();
  const nameById = new Map();
  const candidates = [];
  let startedPoints = 0;
  const countedShaped = [];
  for (const row of counted) {
    const points = price(row.stats);
    pointsFor.set(row.player_id, points);
    if (row.name !== undefined) nameById.set(row.player_id, row.name);
    candidates.push({ playerId: row.player_id, position: row.position });
    // Standard: only a row in a starting slot counts toward the started total;
    // a benched row stays a candidate for the optimal lineup. Best ball keeps
    // no started total - its score is its optimal over the whole pool.
    if (!bestBall && row.slot !== BENCH) startedPoints += points;
    countedShaped.push({
      playerId: row.player_id, position: row.position, slot: row.slot, points,
      name: nameById.get(row.player_id),
    });
  }

  const optimal = optimalLineup(candidates, rosterSlots, pointsFor);
  const optimalPoints = optimal.total;
  const optimalStarters = optimal.starters.map((s) => ({ ...s, name: nameById.get(s.playerId) }));

  // Best ball's score of record IS its optimal lineup (ADR 0022/0023): the two
  // numbers are one, so nothing is ever left on the bench. A standard league
  // scores what it started and rounds that.
  const teamScore = bestBall ? optimalPoints : round2(startedPoints);
  const pointsLeftOnBench = Math.max(0, round2(optimalPoints - teamScore));

  return {
    counted: countedShaped,
    excluded,
    teamScore,
    startedPoints: round2(startedPoints),
    optimalPoints,
    optimalStarters,
    pointsLeftOnBench,
  };
}

module.exports = { countedRoster };
