const pool = require('../modules/pool');
const { logTransaction, notifyLeague } = require('./activity.service');
// The ONE pricer the settle pass uses. The waiver steal is priced under the
// league's rules, the identical formula the score of record uses, not the
// stored default-rules `fantasy_points` column (#739, ADR 0024).
const { calculateFantasyPoints, rulesForLeague } = require('./scoring.service');

/**
 * Weekly league recaps: after a week is finalized, gather its storylines
 * (high score, closest matchup, biggest blowout, bench blunders, waiver
 * steal, playoff odds) and write a narrative into league_analytics
 * (type 'weekly_recap').
 *
 * The narrative comes from Claude when ANTHROPIC_API_KEY is set AND the
 * optional @anthropic-ai/sdk package is installed (same optional-dependency
 * pattern as nodemailer in account.service); otherwise a clean templated
 * version renders from the same data, so the feature never depends on the
 * LLM being available.
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
 * Narrative via Claude. Requires ANTHROPIC_API_KEY and the optional
 * @anthropic-ai/sdk dependency; returns null on any failure so the caller
 * falls back to the template.
 */
async function llmNarrative(facts, { client: suppliedClient } = {}) {
  if (!suppliedClient && !process.env.ANTHROPIC_API_KEY) return null;
  try {
    // Optional dependency — only required when the key is actually configured
    // eslint-disable-next-line global-require
    const client = suppliedClient || new (require('@anthropic-ai/sdk'))();
    const response = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1024,
      system:
        'You write short, punchy fantasy football weekly recaps for a league of friends. ' +
        'Two paragraphs max. Fun trash-talk energy, never mean-spirited. Use ONLY the facts ' +
        'provided. Never invent players, scores, or events. Plain text, no headings, no em dashes.',
      messages: [
        { role: 'user', content: `Write the week ${facts.week} recap from these facts:\n${JSON.stringify(facts, null, 2)}` },
      ],
    });
    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();
    return text || null;
  } catch (err) {
    console.error('LLM recap failed, falling back to template:', err.message);
    return null;
  }
}

/**
 * Build and store the recap for a finalized league week. Idempotent — re-runs
 * overwrite the stored recap. Returns the stored recap data or null when the
 * week has no finalized matchups.
 */
async function generateWeeklyRecap({ leagueId, season, week }) {
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

  // Bench blunder: worst points-left-on-bench among the week's teams
  let benchBlunder = null;
  try {
    const { weekHindsight } = require('./decision.service');
    const teamIds = new Set(
      matchupsResult.rows.flatMap((m) => [m.home_team_id, m.away_team_id])
    );
    for (const teamId of teamIds) {
      const h = await weekHindsight({ leagueId, teamId, season, week });
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
  try {
    const oddsResult = await pool.query(
      `SELECT "data" FROM "league_analytics"
       WHERE "league_id" = $1 AND "type" = 'power_rankings'
       ORDER BY "season" DESC, "week" DESC LIMIT 1`,
      [leagueId]
    );
    const rankings = oddsResult.rows[0] && oddsResult.rows[0].data.rankings;
    if (Array.isArray(rankings)) {
      playoffOdds = rankings
        .slice(0, 3)
        .map(({ name, playoffOdds: po, titleOdds }) => ({ name, playoffOdds: po, titleOdds }));
    }
  } catch (err) {
    console.error('recap: playoff odds lookup failed:', err.message);
  }

  const facts = buildRecapFacts(week, matchupsResult.rows, {
    benchBlunder,
    waiverSteal,
    playoffOdds,
  });
  const narrative = (await llmNarrative(facts)) || templateNarrative(facts);

  const data = { generatedAt: new Date().toISOString(), facts, narrative };
  await pool.query(
    `INSERT INTO "league_analytics" ("league_id", "season", "week", "type", "data")
     VALUES ($1, $2, $3, 'weekly_recap', $4)
     ON CONFLICT ("league_id", "season", "week", "type")
     DO UPDATE SET "data" = EXCLUDED."data", "updated_at" = now()`,
    [leagueId, season, week, JSON.stringify(data)]
  );

  // Post to the league feed + notify members
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
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
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('recap: feed/notification write failed:', error.message);
  } finally {
    client.release();
  }
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
  templateNarrative,
  llmNarrative,
  generateWeeklyRecap,
  getLatestRecap,
};
