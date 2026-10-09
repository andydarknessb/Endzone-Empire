const defaultPool = require('../modules/pool');
const projection = require('./projection.service');
const claude = require('./claude');

/**
 * Projection explanation (ADR 0061, CONTEXT.md): one Narrative per player per
 * week under the pool-wide DEFAULT scoring rules. Template first, stored, then
 * Claude may rewrite it. Names Factors in words only: never a value, a rank or
 * a verdict.
 */

// How many players per position get an explanation each week.
const CUTOFFS = { QB: 24, RB: 60, WR: 75, TE: 24, K: 16, DEF: 16 };

const SYSTEM = 'You explain one fantasy football weekly projection to a manager in one short paragraph. '
  + 'Use ONLY the factors provided. Name what moved the projection and in which direction. '
  + 'Never state a number, a rank, a point total, or a start/sit verdict. Plain text, no headings, no em dashes.';

const PHRASES = {
  opponent: (up) => `The matchup ${up ? 'leans in this player\'s favor' : 'leans against this player'}.`,
  versusOpponent: (up) => `History against this opponent is ${up ? 'favorable' : 'unfavorable'}.`,
  homeAway: (up, f) => `The game is ${f.isHome ? 'at home' : 'on the road'}, which ${up ? 'helps' : 'costs a little'}.`,
  weather: (up) => `Weather is a mild ${up ? 'help' : 'drag'}.`,
  gameEnvironment: (up) => `The expected game environment is ${up ? 'favorable' : 'unfavorable'}.`,
};
const STATUS_SENTENCES = { Q: 'Carries a questionable tag.', D: 'Carries a doubtful tag.' };

// ADR 0061 section 3: Claude's words carry no number and no verdict.
const BAD_OUTPUT = /\d|\b(start|sit|bench|flex|must-start|fade)\b/i;

/** The base sentence: recentProduction's contribution is the baseline itself, not a change. */
function baseSentence(factors) {
  const base = factors && factors.recentProduction;
  if (!base) return null;
  return base.usedPositionBaseline
    ? 'With no track record yet, the projection starts from the position baseline.'
    : 'Built on recent production.';
}

/** The (up to) three available Factors, other than the base, that moved the number most, largest first. */
function topFactors(factors) {
  return Object.keys(PHRASES)
    .map((key) => ({ key, factor: factors && factors[key] }))
    .filter(({ factor }) => factor && factor.available && Number.isFinite(Number(factor.pointsContribution))
      && Number(factor.pointsContribution) !== 0)
    .sort((a, b) => Math.abs(b.factor.pointsContribution) - Math.abs(a.factor.pointsContribution))
    .slice(0, 3);
}

function templateExplanation(factors, { position } = {}) { // eslint-disable-line no-unused-vars
  const status = factors && factors.availability && factors.availability.status;
  const sentences = [baseSentence(factors), STATUS_SENTENCES[status]].filter(Boolean);
  for (const { key, factor } of topFactors(factors)) {
    sentences.push(PHRASES[key](factor.pointsContribution > 0, factor));
  }
  return sentences.length ? sentences.join(' ') : 'No single factor stands out this week.';
}

/** The facts Claude sees: directions as words, never a value. */
function promptFacts(factors, position) {
  return JSON.stringify({
    position,
    base: baseSentence(factors) && (factors.recentProduction.usedPositionBaseline ? 'position baseline' : 'recent production'),
    availabilityStatus: (factors.availability && factors.availability.status) || null,
    factorsLargestFirst: topFactors(factors).map(({ key, factor }) => ({
      factor: key,
      direction: factor.pointsContribution > 0 ? 'up' : 'down',
      ...(key === 'homeAway' ? { isHome: !!factor.isHome } : {}),
    })),
  });
}

async function generateForWeek({ season, week }, { pool = defaultPool, client, now = new Date() } = {}) {
  const counts = { considered: 0, written: 0, enhanced: 0 };
  // The existing-rows read comes first: an unapplied migration throws before a generation is paid for.
  const { rows: existing } = await pool.query(
    'SELECT "player_id" FROM "projection_explanations" WHERE "season" = $1 AND "week" = $2',
    [season, week]
  );
  const done = new Set(existing.map((r) => r.player_id));
  // Position comes from the players rows: a cached projection entry does not carry one.
  const { rows: players } = await pool.query('SELECT "id", "position" FROM "players"');
  const positionById = new Map(players.map((p) => [p.id, p.position]));
  const run = await projection.getWeeklyProjections({
    season, week, playerIds: players.map((p) => p.id), now,
  });
  const byPosition = {};
  for (const [playerId, entry] of run.projections) {
    const position = positionById.get(playerId);
    if (!entry || !(position in CUTOFFS) || !Number.isFinite(entry.mean)) continue;
    if (entry.factors && entry.factors.availability && entry.factors.availability.available === false) continue;
    (byPosition[position] ||= []).push({ playerId, entry });
  }

  for (const [position, list] of Object.entries(byPosition)) {
    const top = list.sort((a, b) => b.entry.mean - a.entry.mean).slice(0, CUTOFFS[position]);
    for (const { playerId, entry } of top) {
      counts.considered += 1;
      if (done.has(playerId)) continue;
      try {
        const inserted = await pool.query(
          `INSERT INTO "projection_explanations" ("player_id", "season", "week", "narrative", "narrative_source", "model_version")
           VALUES ($1, $2, $3, $4, 'template', $5) ON CONFLICT DO NOTHING`,
          [playerId, season, week, templateExplanation(entry.factors), entry.modelVersion || run.modelVersion || null]
        );
        if (!inserted.rowCount) continue;
        counts.written += 1;
        const text = await claude.narrative(
          { feature: 'projection_explanation', system: SYSTEM, user: promptFacts(entry.factors, position) },
          { pool, client, now }
        );
        if (!text || BAD_OUTPUT.test(text)) continue;
        await pool.query(
          `UPDATE "projection_explanations" SET "narrative" = $1, "narrative_source" = 'llm'
            WHERE "player_id" = $2 AND "season" = $3 AND "week" = $4`,
          [text, playerId, season, week]
        );
        counts.enhanced += 1;
      } catch (err) {
        console.error('projection explanation failed for player', playerId, err.message);
      }
    }
  }
  return counts;
}

module.exports = { generateForWeek, templateExplanation, CUTOFFS };
