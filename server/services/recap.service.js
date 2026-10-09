const pool = require('../modules/pool');
const { withTransaction } = require('../modules/withTransaction');
const { logTransaction, notifyLeague } = require('./activity.service');
// The ONE pricer the settle pass uses. The waiver steal is priced under the
// league's rules, the identical formula the score of record uses, not the
// stored default-rules `fantasy_points` column (#739, ADR 0024).
const { calculateFantasyPoints, rulesForLeague } = require('./scoringRules');
const { CALLED_SHOT_BOLD_PROBABILITY } = require('./trophy.service');
const claude = require('./claude');

/**
 * Weekly league recaps: after a week is finalized, gather its storylines
 * (high score, closest matchup, biggest blowout, bench blunders, waiver
 * steal, playoff odds) and write a narrative into league_analytics
 * (type 'weekly_recap').
 *
 * The narrative comes from Claude when ANTHROPIC_API_KEY is set and the monthly
 * budget is not spent (ADR 0061); otherwise a clean templated version renders
 * from the same data, so the feature never depends on the LLM being available.
 */

function round2(x) {
  return Math.round(Number(x) * 100) / 100;
}

/**
 * Pure: distill a finalized week's matchup rows (+ optional extras) into the
 * storyline facts both narrative paths consume.
 * matchups: [{ home_team_name, away_team_name, home_score, away_score, final }]
 * extras: { benchBlunder?, waiverSteal?, playoffOdds? }
 */
function buildRecapFacts(week, matchups, extras = {}) {
  const finals = matchups.filter((m) => m.final);
  const facts = { week, matchupCount: finals.length, ...extras };
  if (finals.length === 0) return facts;

  let high = null;
  for (const m of finals) {
    for (const side of [
      { team: m.home_team_name, points: Number(m.home_score) },
      { team: m.away_team_name, points: Number(m.away_score) },
    ]) {
      if (!high || side.points > high.points) high = side;
    }
  }
  facts.highestScorer = { team: high.team, points: round2(high.points) };

  const withMargin = finals.map((m) => ({
    home: m.home_team_name,
    away: m.away_team_name,
    homeScore: round2(m.home_score),
    awayScore: round2(m.away_score),
    margin: round2(Math.abs(Number(m.home_score) - Number(m.away_score))),
  }));
  withMargin.sort((a, b) => a.margin - b.margin);
  facts.closestMatchup = withMargin[0];
  facts.biggestBlowout = withMargin[withMargin.length - 1];
  return facts;
}

/**
 * Pure: the week's best waiver steal from its candidate pickups, priced under
 * the league's rules (#739). In the manner of buildRecapFacts, this is a pure
 * function over rows so it is testable without a database.
 *
 * pickups: [{ player, team, stats }] - one per waiver transaction in the
 * league joined to that week's `player_stats`. Each is priced with the settle
 * pass's pricer under `rules`, and the highest wins; a statless pickup prices
 * at 0. The "only when points > 0" guard is unchanged, so a pool whose best is
 * 0 or negative yields no steal. Returns { player, team, points } or null.
 */
function pickWaiverSteal(pickups, rules) {
  let best = null;
  for (const pickup of pickups || []) {
    const points = calculateFantasyPoints(pickup.stats, rules);
    if (!best || points > best.points) {
      best = { player: pickup.player, team: pickup.team, points };
    }
  }
  if (!best || best.points <= 0) return null;
  return { player: best.player, team: best.team, points: round2(best.points) };
}

/**
 * Pure: the Recap's lineup-trophy facts (#1854), read from the week's trophy
 * rows (`type`, `team_name`, `data`) and never recomputed: the award pass is
 * the one place Perfect Lineup and Captain Hindsight are decided. A week with
 * neither adds no keys, so an ordinary Recap's facts are unchanged.
 */
function lineupTrophyFacts(rows) {
  const perfectLineups = [];
  const captainHindsight = [];
  for (const r of rows || []) {
    if (r.type === 'perfect_lineup') {
      perfectLineups.push({ team: r.team_name });
    } else if (r.type === 'captain_hindsight') {
      const d = r.data || {};
      captainHindsight.push({
        team: r.team_name, margin: d.margin, bench: d.benchPlayer, starter: d.starter || null, slot: d.slot,
      });
    }
  }
  const facts = {};
  if (perfectLineups.length > 0) facts.perfectLineups = perfectLineups;
  if (captainHindsight.length > 0) facts.captainHindsight = captainHindsight;
  return facts;
}

/**
 * Pure: the Recap's Called shot facts (#1860), read from the week's resolved
 * `lineup_overrides` rows and never recomputed: the judge at Advance week is the
 * one place a shot is decided. A void is a non-event and adds nothing. A week
 * with no hit or miss adds no key. Bold is a call made at or above the trophy's bold probability.
 */
function calledShotFacts(rows) {
  const calledShots = (rows || [])
    .filter((r) => r.outcome === 'hit' || r.outcome === 'miss')
    .map((r) => ({
      team: r.team_name,
      starter: r.starter_name,
      benched: r.benched_name,
      starterPoints: Number(r.starter_points_actual),
      benchedPoints: Number(r.benched_points_actual),
      outcome: r.outcome,
      bold: Number(r.probability) >= CALLED_SHOT_BOLD_PROBABILITY,
    }));
  return calledShots.length > 0 ? { calledShots } : {};
}

/** Pure: render the fallback narrative from recap facts. */
function templateNarrative(facts) {
  const lines = [];
  if (facts.highestScorer) {
    lines.push(
      `${facts.highestScorer.team} lit up the scoreboard with a league-best ` +
        `${facts.highestScorer.points} points in week ${facts.week}.`
    );
  }
  if (facts.closestMatchup && facts.closestMatchup.margin <= 10) {
    const c = facts.closestMatchup;
    const winner = c.homeScore >= c.awayScore ? c.home : c.away;
    const loser = winner === c.home ? c.away : c.home;
    lines.push(
      `The nail-biter of the week: ${winner} edged ${loser} by just ${c.margin} ` +
        `(${c.homeScore}-${c.awayScore}).`
    );
  }
  if (facts.biggestBlowout && facts.biggestBlowout.margin > 30) {
    const b = facts.biggestBlowout;
    const winner = b.homeScore >= b.awayScore ? b.home : b.away;
    const loser = winner === b.home ? b.away : b.home;
    lines.push(`${winner} steamrolled ${loser} by ${b.margin} in the week's biggest blowout.`);
  }
  if (facts.benchBlunder && facts.benchBlunder.pointsLeftOnBench > 0) {
    lines.push(
      `Bench blunder of the week: ${facts.benchBlunder.team} left ` +
        `${facts.benchBlunder.pointsLeftOnBench} points sitting on the bench.`
    );
  }
  for (const p of facts.perfectLineups || []) {
    lines.push(`${p.team} set a perfect lineup.`);
  }
  for (const c of facts.captainHindsight || []) {
    // A tie has margin 0: "lost by 0" would be false, so a tied Matchup reads "tied".
    const result = c.margin > 0 ? `lost by ${c.margin}` : 'tied';
    const move = c.starter ? `starting ${c.bench} over ${c.starter} at ${c.slot}` : `filling ${c.slot} with ${c.bench}`;
    lines.push(`Captain Hindsight: ${c.team} ${result}; ${move} would have won it.`);
  }
  for (const c of facts.calledShots || []) {
    const score = `${c.starterPoints} to ${c.benchedPoints}`;
    const line = c.outcome === 'hit'
      ? `${c.team} called it: ${c.starter} over ${c.benched}, ${score}.`
      : `${c.team} called ${c.starter} over ${c.benched} and missed, ${score}.`;
    lines.push(c.bold ? `${line} A bold call.` : line);
  }
  if (facts.waiverSteal) {
    lines.push(
      `Waiver steal: ${facts.waiverSteal.player} rewarded ${facts.waiverSteal.team} ` +
        `with ${facts.waiverSteal.points} points off the wire.`
    );
  }
  if (facts.playoffOdds && facts.playoffOdds.length > 0) {
    const leader = facts.playoffOdds[0];
    lines.push(
      `${leader.name} now leads the playoff race at ${Math.round(leader.playoffOdds * 100)}% odds.`
    );
  }
  if (lines.length === 0) {
    lines.push(`Week ${facts.week} is in the books.`);
  }
  return lines.join(' ');
}

/**
 * Narrative via Claude (services/claude.js: ANTHROPIC_API_KEY, monthly budget);
 * returns null on any failure so the caller falls back to the template.
 */
async function llmNarrative(facts, { client, placeholders } = {}) {
  return claude.narrative({
    feature: 'recap',
    system:
      'You write short, punchy fantasy football weekly recaps for a league of friends. ' +
      'Two paragraphs max. Fun trash-talk energy, never mean-spirited. Use ONLY the facts ' +
      'provided. Never invent players, scores, or events. Plain text, no headings, no em dashes. ' +
      'Team names appear as [[team:N]] tokens; copy each token exactly where the team is named.',
    user: `Write the week ${facts.week} recap from these facts:\n${JSON.stringify(facts, null, 2)}`,
    placeholders,
  }, { client });
}

/**
 * Pure: a deep copy of `facts` with every team name replaced by its
 * `[[team:<id>]]` token (a manager typed those names; ADR 0061 section 5),
 * and the token -> name map to put them back. `idByName` is name -> teams.id.
 */
function tokenizeTeamNames(facts, idByName) {
  const placeholders = {};
  const walk = (v) => {
    if (typeof v === 'string' && idByName.has(v)) {
      const token = `[[team:${idByName.get(v)}]]`;
      placeholders[token] = v;
      return token;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return { facts: walk(facts), placeholders };
}

/**
 * Compute and store the recap for a finalized league week. Idempotent —
 * re-runs overwrite the stored recap. Returns the stored recap data or null
 * when the week has no finalized matchups (a no-op — nothing is written).
 *
 * Deliberately silent: this never posts a feed entry or a member
 * notification. That is `announceWeeklyRecap`'s job, kept separate so a
 * caller that only needs the stored row corrected (a stat correction
 * rebuild, #1409) can skip the announcement entirely — the correction pass
 * already sent its own "scores were updated" notice, and a rebuilt recap is
 * not a second event.
 */
async function computeAndStoreWeeklyRecap({ leagueId, season, week }) {
  const matchupsResult = await pool.query(
    `SELECT "matchups".*,
            "home"."name" AS "home_team_name", "away"."name" AS "away_team_name"
     FROM "matchups"
     JOIN "teams" "home" ON "home"."id" = "matchups"."home_team_id"
     JOIN "teams" "away" ON "away"."id" = "matchups"."away_team_id"
     WHERE "matchups"."league_id" = $1 AND "matchups"."season" = $2 AND "matchups"."week" = $3`,
    [leagueId, season, week]
  );
  if (!matchupsResult.rows.some((m) => m.final)) return null;

  // The league's scoring rules, for the waiver steal's league-aware pricing
  // (#739). Loaded once the week is known to have a finalized matchup.
  const leagueResult = await pool.query(
    `SELECT * FROM "leagues" WHERE "id" = $1`,
    [leagueId]
  );
  const league = leagueResult.rows[0];

  // Bench blunder: worst points-left-on-bench among the week's teams. The stored
  // points-left row (#1861, ADR 0054) is read when the week has one, so a silent
  // rebuild on a correction cannot drift from the frozen numbers; a week with no
  // row (best ball, or one advanced before the row existed) reads Hindsight live.
  let benchBlunder = null;
  try {
    const { weekHindsight, POINTS_LEFT_TYPE } = require('./decision.service');
    const stored = await pool.query(
      `SELECT "data" FROM "league_analytics"
       WHERE "league_id" = $1 AND "season" = $2 AND "week" = $3 AND "type" = $4`,
      [leagueId, season, week, POINTS_LEFT_TYPE]
    );
    const frozen = stored.rows[0] && new Map(stored.rows[0].data.teams.map((x) => [Number(x.teamId), x.pointsLeft]));
    const teamIds = new Set(
      matchupsResult.rows.flatMap((m) => [m.home_team_id, m.away_team_id])
    );
    for (const teamId of teamIds) {
      const h = frozen
        ? { pointsLeftOnBench: frozen.get(Number(teamId)) ?? 0 }
        : await weekHindsight({ leagueId, teamId, season, week });
      if (!benchBlunder || h.pointsLeftOnBench > benchBlunder.pointsLeftOnBench) {
        const name = matchupsResult.rows
          .map((m) => (m.home_team_id === teamId ? m.home_team_name : m.away_team_id === teamId ? m.away_team_name : null))
          .find(Boolean);
        benchBlunder = { team: name, pointsLeftOnBench: h.pointsLeftOnBench };
      }
    }
    if (benchBlunder && benchBlunder.pointsLeftOnBench <= 0) benchBlunder = null;
  } catch (err) {
    console.error('recap: bench blunder lookup failed:', err.message);
  }

  // Waiver steal: best-scoring player claimed off waivers during this week,
  // priced under the league's rules (#739). The SQL fetches every waiver
  // pickup joined to the week's stats; the SQL ORDER BY on the default-rules
  // column is gone because the winner is decided by the league-aware pricer,
  // not the column.
  let waiverSteal = null;
  try {
    // No league row is not a reason to price the steal under the default
    // rules - that is the exact miscount #739 exists to stop. Without the
    // league's rules there is no league-priced steal to name, so leave it null.
    if (!league) throw new Error('league not found; cannot price the waiver steal under its rules');
    const stealResult = await pool.query(
      `SELECT "players"."name" AS "player", "teams"."name" AS "team",
              "player_stats"."stats" AS "stats"
       FROM "transactions"
       JOIN "teams" ON "teams"."id" = "transactions"."team_id"
       JOIN "players" ON "players"."id" = ("transactions"."detail"->>'playerId')::int
       JOIN "player_stats" ON "player_stats"."player_id" = "players"."id"
         AND "player_stats"."season" = $2 AND "player_stats"."week" = $3
       WHERE "transactions"."league_id" = $1 AND "transactions"."type" = 'waiver'`,
      [leagueId, season, week]
    );
    waiverSteal = pickWaiverSteal(stealResult.rows, rulesForLeague(league));
  } catch (err) {
    console.error('recap: waiver steal lookup failed:', err.message);
  }

  // Updated playoff odds from the latest Monte Carlo run
  let playoffOdds = null;
  let oddsRankings = [];
  try {
    const oddsResult = await pool.query(
      `SELECT "data" FROM "league_analytics"
       WHERE "league_id" = $1 AND "type" = 'power_rankings'
       ORDER BY "season" DESC, "week" DESC LIMIT 1`,
      [leagueId]
    );
    const rankings = oddsResult.rows[0] && oddsResult.rows[0].data.rankings;
    if (Array.isArray(rankings)) {
      oddsRankings = rankings;
      playoffOdds = rankings
        .slice(0, 3)
        .map(({ name, playoffOdds: po, titleOdds }) => ({ name, playoffOdds: po, titleOdds }));
    }
  } catch (err) {
    console.error('recap: playoff odds lookup failed:', err.message);
  }

  // Lineup trophies (#1854): the Settle follow-up awards trophies before it
  // builds this Recap, so the rows are already there. Read, never recomputed.
  let lineupFacts = {};
  try {
    const trophyRows = await pool.query(
      `SELECT "trophies"."type", "trophies"."data", "teams"."name" AS "team_name"
       FROM "trophies" JOIN "teams" ON "teams"."id" = "trophies"."team_id"
       WHERE "trophies"."league_id" = $1 AND "trophies"."season" = $2 AND "trophies"."week" = $3
         AND "trophies"."type" IN ('perfect_lineup', 'captain_hindsight')
       ORDER BY "trophies"."id"`,
      [leagueId, season, week]
    );
    lineupFacts = lineupTrophyFacts(trophyRows.rows);
  } catch (err) {
    console.error('recap: lineup trophy lookup failed:', err.message);
  }

  // Called shots (#1860): the week's own resolved rows, judged by the same
  // trophy step. A catch-up row of an earlier week gets no line here.
  let calledFacts = {};
  try {
    const shotRows = await pool.query(
      `SELECT "teams"."name" AS "team_name", "lineup_overrides"."outcome", "lineup_overrides"."probability",
              "lineup_overrides"."starter_points_actual", "lineup_overrides"."benched_points_actual",
              "starter"."name" AS "starter_name", "benched"."name" AS "benched_name"
       FROM "lineup_overrides"
       JOIN "teams" ON "teams"."id" = "lineup_overrides"."team_id"
       JOIN "players" AS "starter" ON "starter"."id" = "lineup_overrides"."starter_player_id"
       JOIN "players" AS "benched" ON "benched"."id" = "lineup_overrides"."benched_player_id"
       WHERE "lineup_overrides"."league_id" = $1 AND "lineup_overrides"."season" = $2
         AND "lineup_overrides"."week" = $3 AND "lineup_overrides"."called"
         AND "lineup_overrides"."outcome" IN ('hit', 'miss')
       ORDER BY "lineup_overrides"."id"`,
      [leagueId, season, week]
    );
    calledFacts = calledShotFacts(shotRows.rows);
  } catch (err) {
    console.error('recap: called shot lookup failed:', err.message);
  }

  const facts = buildRecapFacts(week, matchupsResult.rows, {
    benchBlunder,
    waiverSteal,
    playoffOdds,
    ...lineupFacts,
    ...calledFacts,
  });
  // Template first (ADR 0061): the stored row never waits on Claude.
  const data = { generatedAt: new Date().toISOString(), facts, narrative: templateNarrative(facts) };
  const store = () => pool.query(
    `INSERT INTO "league_analytics" ("league_id", "season", "week", "type", "data")
     VALUES ($1, $2, $3, 'weekly_recap', $4)
     ON CONFLICT ("league_id", "season", "week", "type")
     DO UPDATE SET "data" = EXCLUDED."data", "updated_at" = now()`,
    [leagueId, season, week, JSON.stringify(data)]
  );
  await store();

  // Every team of the week is in a matchup row or the power rankings.
  const idByName = new Map();
  for (const m of matchupsResult.rows) {
    idByName.set(m.home_team_name, m.home_team_id);
    idByName.set(m.away_team_name, m.away_team_id);
  }
  for (const r of oddsRankings) idByName.set(r.name, r.teamId);
  const prompt = tokenizeTeamNames(facts, idByName);
  const enhanced = await llmNarrative(prompt.facts, { placeholders: prompt.placeholders });
  if (enhanced) {
    data.narrative = enhanced;
    await store();
  }
  return data;
}

/**
 * Post the "week N recap is in" feed entry and member notification. Best-
 * effort: called after the recap is already stored, so a feed/notify failure
 * never fails the recap - the swallow sits here at the call site around
 * withTransaction (ADR 0033, #1072). The ROLLBACK was unguarded before, so a
 * rejecting rollback escaped this swallow; the wrapper now contains it
 * (destroying the connection). A connect failure now reaches this catch too
 * (the checkout moved inside the wrapper) and is swallowed the same way.
 */
async function announceWeeklyRecap({ leagueId, week, season, narrative }) {
  try {
    await withTransaction(
      pool,
      async (client) => {
        await logTransaction(client, {
          leagueId,
          type: 'recap',
          detail: { season, week },
        });
        await notifyLeague(client, {
          leagueId,
          type: 'recap',
          message: `The week ${week} recap is in: ${narrative.slice(0, 120)}${narrative.length > 120 ? '…' : ''}`,
          data: { season, week },
        });
      },
      { label: 'recap-notify' }
    );
  } catch (error) {
    console.error('recap: feed/notification write failed:', error.message);
  }
}

/**
 * Build and store the recap for a finalized league week, then announce it
 * (feed entry plus member notification). The advance-week path's entry
 * point; unchanged in behavior from before the compute/announce split.
 * Returns the stored recap data or null when the week has no finalized
 * matchups.
 */
async function generateWeeklyRecap({ leagueId, season, week }) {
  const data = await computeAndStoreWeeklyRecap({ leagueId, season, week });
  if (!data) return null;
  await announceWeeklyRecap({ leagueId, season, week, narrative: data.narrative });
  return data;
}

/** Latest stored recap for a league. */
async function getLatestRecap({ leagueId }) {
  const result = await pool.query(
    `SELECT "season", "week", "data" FROM "league_analytics"
     WHERE "league_id" = $1 AND "type" = 'weekly_recap'
     ORDER BY "season" DESC, "week" DESC LIMIT 1`,
    [leagueId]
  );
  return result.rows[0] || null;
}

module.exports = {
  buildRecapFacts,
  pickWaiverSteal,
  lineupTrophyFacts,
  calledShotFacts,
  templateNarrative,
  llmNarrative,
  computeAndStoreWeeklyRecap,
  announceWeeklyRecap,
  generateWeeklyRecap,
  getLatestRecap,
};
