/**
 * Auto-generated NFL game recaps for the public layer.
 *
 * Recaps a real NFL game (score, per-quarter line score, scoring plays, top
 * fantasy performers under DEFAULT scoring) — public data only, never a
 * private league matchup. Distinct from recap.service.js (league weekly
 * recaps).
 *
 * Narrative guarantee (guardrail #5): `templateNarrative` is a pure function of
 * the structured facts and is the DEFAULT, GUARANTEED path. An optional LLM
 * call (ANTHROPIC_API_KEY + the optional @anthropic-ai/sdk, same pattern as
 * recap.service.llmNarrative) may ENHANCE the text, but any failure/absence
 * falls back silently to the template. The persisted `data` always contains
 * the full structured facts, so every recap page renders completely from the
 * stored row alone — no recap ever depends on an LLM call succeeding.
 *
 * generateForGame is idempotent: re-running upserts and regenerates cleanly.
 */
const pool = require('../modules/pool');
const {
  RECAPS_TABLE_SQL,
  DATA_VERSION,
  GENERATOR_VERSION,
} = require('../modules/recapStorage');
const { tank01Body } = require('./scoring.service');
const { tank01Get, retryAfterMs } = require('../modules/tank01Client');
const { statLine } = require('./publicRead.service');

// ---- pure normalizers -------------------------------------------------------

function num(value) {
  const parsed = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Per-quarter line score from a Tank01 box score:
 *   { home: [q1,q2,q3,q4, ...ot], away: [...] }
 * Tolerant of missing sides/quarters and any number of overtime periods.
 * Returns null when there's no line score at all.
 */
function normalizeLineScore(box) {
  const ls = box && box.lineScore;
  if (!ls || typeof ls !== 'object') return null;
  const parseSide = (side) => {
    const s = ls[side];
    if (!s || typeof s !== 'object') return null;
    const periods = ['Q1', 'Q2', 'Q3', 'Q4'].map((q) => num(s[q]));
    // Any overtime periods Tank01 reports (OT, OT1, OT2, …), in key order.
    for (const key of Object.keys(s)) {
      if (/^OT/i.test(key)) periods.push(num(s[key]));
    }
    return periods;
  };
  const home = parseSide('home');
  const away = parseSide('away');
  if (!home && !away) return null;
  return { home: home || [], away: away || [] };
}

/**
 * Chronological scoring plays from a Tank01 box score. Accepts either an array
 * or a keyed object, tolerates missing fields, and skips entries with nothing
 * usable. Each play: { quarter, clock, team, description, homeScore, awayScore }.
 */
function normalizeScoringPlays(box) {
  const container = box && box.scoringPlays;
  const raw = Array.isArray(container)
    ? container
    : container && typeof container === 'object'
      ? Object.values(container)
      : [];
  const out = [];
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue;
    const description = String(p.score || p.scoreDetails || p.play || '').trim();
    const team = p.team || p.teamAbv || null;
    if (!description && !team) continue; // nothing worth showing
    out.push({
      quarter: p.scorePeriod || p.period || p.quarter ? String(p.scorePeriod || p.period || p.quarter) : null,
      clock: p.scoreTime || p.gameClock || p.clock ? String(p.scoreTime || p.gameClock || p.clock) : null,
      team: team ? String(team) : null,
      description,
      homeScore: num(p.homeScore),
      awayScore: num(p.awayScore),
    });
  }
  return out;
}

/**
 * Number of times the lead changed hands over the scoring plays. Ties don't
 * count as a change; the first score to break a tie establishes (not changes)
 * the lead.
 */
function countLeadChanges(scoringPlays) {
  let leader = 0; // 1 = home ahead, -1 = away ahead, 0 = tied
  let changes = 0;
  for (const p of scoringPlays) {
    const cur = Math.sign((Number(p.homeScore) || 0) - (Number(p.awayScore) || 0));
    if (cur !== 0 && leader !== 0 && cur !== leader) changes += 1;
    if (cur !== 0) leader = cur;
  }
  return changes;
}

function marginVerb(margin) {
  if (margin <= 3) return 'edged';
  if (margin <= 8) return 'held off';
  if (margin <= 17) return 'beat';
  return 'routed';
}

/**
 * The guaranteed default narrative: 2–4 plain-text sentences from structured
 * facts only. Pure and side-effect free.
 */
function templateNarrative(facts) {
  const {
    homeTeam, awayTeam, homeScore, awayScore,
    scoringPlays = [], topPerformers = [], overtime = false,
  } = facts;
  const sentences = [];

  if (homeScore === awayScore) {
    sentences.push(`The ${homeTeam} and ${awayTeam} played to a ${homeScore}-${awayScore} tie${overtime ? ' after overtime' : ''}.`);
  } else {
    const homeWon = homeScore > awayScore;
    const winner = homeWon ? homeTeam : awayTeam;
    const loser = homeWon ? awayTeam : homeTeam;
    const hi = Math.max(homeScore, awayScore);
    const lo = Math.min(homeScore, awayScore);
    const margin = hi - lo;
    sentences.push(
      `The ${winner} ${marginVerb(margin)} the ${loser} ${hi}-${lo}${overtime ? ' in overtime' : ''}.`
    );
  }

  const leadChanges = countLeadChanges(scoringPlays);
  if (leadChanges >= 2) {
    sentences.push(`The lead changed hands ${leadChanges} times before it was settled.`);
  } else if (Math.abs(homeScore - awayScore) <= 3 && homeScore !== awayScore) {
    sentences.push('It came down to the wire.');
  }

  if (topPerformers.length > 0) {
    const top = topPerformers[0];
    let line = `${top.name} (${top.nflTeam}) paced all fantasy scorers with ${top.fantasyPoints} points`;
    const second = topPerformers[1];
    if (second) line += `, with ${second.name} close behind at ${second.fantasyPoints}`;
    sentences.push(`${line}.`);
  } else if (sentences.length < 2) {
    sentences.push('Full box score and scoring summary below.');
  }

  return sentences.join(' ');
}

// ---- optional LLM enhancement (never required) ------------------------------

/**
 * Narrative via Claude. Requires ANTHROPIC_API_KEY and the optional
 * @anthropic-ai/sdk dependency; returns null on any failure so the caller
 * falls back to the guaranteed template. Mirrors recap.service.llmNarrative.
 */
async function llmNarrative(facts, { client: suppliedClient } = {}) {
  if (!suppliedClient && !process.env.ANTHROPIC_API_KEY) return null;
  try {
    // Optional dependency — only required when the key is actually configured.
    // eslint-disable-next-line global-require
    const client = suppliedClient || new (require('@anthropic-ai/sdk'))();
    const response = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1024,
      system:
        'You write short, punchy NFL game recaps for a fantasy football audience. ' +
        'Two short paragraphs max. Lead with the result, then the fantasy angle. Use ONLY ' +
        'the facts provided. Never invent players, scores, or events. Plain text, no headings, no em dashes.',
      messages: [
        { role: 'user', content: `Write a recap of this NFL game from these facts:\n${JSON.stringify(facts, null, 2)}` },
      ],
    });
    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();
    return text || null;
  } catch (err) {
    console.error('LLM game recap failed, falling back to template:', err.message);
    return null;
  }
}

// ---- top performers ---------------------------------------------------------

function serializeTopPerformer(row) {
  return {
    playerId: row.id,
    name: row.name,
    position: row.position,
    nflTeam: row.nfl_team,
    photoUrl: row.photo_url,
    fantasyPoints: Math.round(Number(row.fantasy_points) * 10) / 10,
    statLine: statLine(row.stats),
  };
}

/**
 * Top ~6 fantasy performers (DEFAULT scoring) across both teams for the game's
 * season/week. Matches by normalized team abbreviation so "WSH"/"WAS"-style
 * variance between live_game_states and players.nfl_team still lines up.
 */
async function fetchTopPerformers({ season, week, homeTeam, awayTeam, limit = 6 }) {
  const res = await pool.query(
    `SELECT "p"."id", "p"."name", "p"."position", "p"."nfl_team", "p"."photo_url",
            "ps"."fantasy_points", "ps"."stats"
     FROM "player_stats" "ps"
     JOIN "players" "p" ON "p"."id" = "ps"."player_id"
     WHERE "ps"."season" = $1 AND "ps"."week" = $2
       AND fn_normalize_nfl_team("p"."nfl_team") IN
           (fn_normalize_nfl_team($3), fn_normalize_nfl_team($4))
     ORDER BY "ps"."fantasy_points" DESC
     LIMIT $5`,
    [season, week, homeTeam, awayTeam, limit]
  );
  return res.rows.map(serializeTopPerformer);
}

// ---- orchestrator -----------------------------------------------------------

const UPSERT_SQL = `
  INSERT INTO ${RECAPS_TABLE_SQL}
    ("tank01_game_id", "season", "week", "home_team", "away_team",
     "home_score", "away_score", "final_at", "data", "data_version",
     "generator_version", "generated_at", "updated_at")
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
  ON CONFLICT ("tank01_game_id") DO UPDATE SET
    "season" = EXCLUDED."season",
    "week" = EXCLUDED."week",
    "home_team" = EXCLUDED."home_team",
    "away_team" = EXCLUDED."away_team",
    "home_score" = EXCLUDED."home_score",
    "away_score" = EXCLUDED."away_score",
    "final_at" = EXCLUDED."final_at",
    "data" = EXCLUDED."data",
    "data_version" = EXCLUDED."data_version",
    "generator_version" = EXCLUDED."generator_version",
    "generated_at" = EXCLUDED."generated_at",
    "updated_at" = now()
  RETURNING "tank01_game_id"
`;

/**
 * Generate (or regenerate) the recap for one finalized NFL game. No-op with a
 * logged skip when the game is missing or not yet final. Idempotent.
 *
 * @param {string} tank01GameId
 * @param {{ api?, client? }} deps  api = Tank01 client (rapidApiClient()),
 *   client = Anthropic client (tests inject both; production uses defaults).
 * @returns {Promise<object|null>} the persisted recap data, or null on skip.
 */
async function generateForGame(tank01GameId, { api, client } = {}) {
  const stateRes = await pool.query(
    `SELECT "tank01_game_id", "season", "week", "home_team", "away_team",
            "game_status", "current_score_home", "current_score_away",
            "quarter", "last_updated", "final_stats_synced_at"
     FROM "live_game_states" WHERE "tank01_game_id" = $1`,
    [tank01GameId]
  );
  const state = stateRes.rows[0];
  if (!state) {
    console.log(`gameRecap: no live_game_states row for ${tank01GameId}, skipping`);
    return null;
  }
  if (state.game_status !== 'final') {
    console.log(`gameRecap: ${tank01GameId} is ${state.game_status}, not final; skipping`);
    return null;
  }

  // 'essential' priority: this is the last Tank01 call we'd ever shed, because
  // one fetch serves BOTH the recap and this game's final stat ingest below.
  const boxResponse = await tank01Get('/getNFLBoxScore', {
    params: { gameID: tank01GameId, playByPlay: 'true', fantasyPoints: 'false' },
    priority: 'essential',
    transport: api, // tests inject a fake client; uncounted when present
  });
  const box = tank01Body(boxResponse.data) || {};

  // Ingest this game's final stats from the SAME box score, before building the
  // recap. syncWeekStats used to fetch it separately (2x per game); now whoever
  // gets here first pays, and `final_stats_synced_at` tells the other path to
  // skip. Never fatal: a recap with stale stats still beats no recap, and the
  // Mon-Thu nflverse finalization pass is the authoritative backstop either way.
  if (!state.final_stats_synced_at) {
    try {
      const scoring = require('./scoring.service');
      const maps = await scoring.loadWeekMaps({ season: state.season, week: state.week });
      await scoring.applyGameBoxScore({ box, season: state.season, week: state.week, maps });
      await scoring.markFinalStatsSynced(tank01GameId);
    } catch (err) {
      console.error('gameRecap: final stat ingest failed for %s:', tank01GameId, err.message);
    }
  }

  const lineScore = normalizeLineScore(box);
  const scoringPlays = normalizeScoringPlays(box);
  const overtime = Boolean(lineScore && ((lineScore.home && lineScore.home.length > 4) || (lineScore.away && lineScore.away.length > 4)));

  // Final score is what our own poller recorded (authoritative for a final
  // game) rather than trusting box-score totals.
  const homeScore = Number(state.current_score_home) || 0;
  const awayScore = Number(state.current_score_away) || 0;

  const topPerformers = await fetchTopPerformers({
    season: state.season,
    week: state.week,
    homeTeam: state.home_team,
    awayTeam: state.away_team,
  });

  const facts = {
    season: state.season,
    week: state.week,
    homeTeam: state.home_team,
    awayTeam: state.away_team,
    homeScore,
    awayScore,
    overtime,
    lineScore,
    scoringPlays,
    topPerformers,
  };

  const template = templateNarrative(facts);
  const enhanced = await llmNarrative(facts, { client });
  const narrative = enhanced || template;
  const narrativeSource = enhanced ? 'llm' : 'template';
  const generatedAt = new Date().toISOString();

  const data = {
    lineScore,
    scoringPlays,
    topPerformers,
    narrative,
    narrativeSource,
    generatedAt,
  };

  const finalAt = state.last_updated || new Date();
  await pool.query(UPSERT_SQL, [
    tank01GameId,
    state.season,
    state.week,
    state.home_team,
    state.away_team,
    homeScore,
    awayScore,
    finalAt,
    JSON.stringify(data),
    DATA_VERSION,
    GENERATOR_VERSION,
    generatedAt,
  ]);

  return data;
}

// ---- concurrency-limited queue + reconciliation sweep -----------------------
//
// A burst of games going final near-simultaneously (end of the Sunday early
// window) would otherwise fire N concurrent /getNFLBoxScore fetches at once.
// Both the live-transition trigger AND the reconciliation sweep enqueue here,
// so the total box-score fan-out is bounded and deduped by tank01_game_id.
// A rate-limit (429) response backs the whole queue off (honoring Retry-After)
// and requeues the game rather than losing it; anything the queue still drops
// is healed later by the sweep.

const RECAP_QUEUE_CONCURRENCY = Number(process.env.RECAP_QUEUE_CONCURRENCY) || 2;
const RECAP_MAX_RETRIES = 4;
const SWEEP_MAX_AGE_DAYS = Number(process.env.RECAP_SWEEP_MAX_AGE_DAYS) || 14;
const SWEEP_LIMIT = 100;

// `retryAfterMs` now lives in modules/tank01Client (one definition shared by the
// metered client's own backoff and this queue) and is re-exported below so the
// queue's default `backoffFor` and existing tests keep importing it from here.

/**
 * In-process work queue with a hard concurrency cap and dedupe by game id.
 * The `worker` is injectable so tests can exercise the concurrency bound,
 * dedupe, and backoff without touching the network. Fire-and-forget:
 * `enqueue` returns whether the id was newly accepted (false = already
 * queued/in-flight).
 */
function createRecapQueue({
  worker,
  concurrency = RECAP_QUEUE_CONCURRENCY,
  maxRetries = RECAP_MAX_RETRIES,
  backoffFor = retryAfterMs,
} = {}) {
  const pending = [];
  const tracked = new Set(); // queued OR in-flight — the dedupe set
  let active = 0;
  let backoffUntil = 0;
  let resumeTimer = null;

  function enqueue(gameId, opts = {}) {
    if (tracked.has(gameId)) return false;
    tracked.add(gameId);
    pending.push({ gameId, opts, attempts: 0 });
    drain();
    return true;
  }

  function drain() {
    if (Date.now() < backoffUntil) return scheduleResume();
    while (active < concurrency && pending.length > 0 && Date.now() >= backoffUntil) {
      runJob(pending.shift());
    }
    return undefined;
  }

  async function runJob(job) {
    active += 1;
    let requeued = false;
    try {
      await worker(job.gameId, job.opts);
    } catch (err) {
      const wait = backoffFor(err);
      if (wait != null && job.attempts < maxRetries) {
        job.attempts += 1;
        backoffUntil = Math.max(backoffUntil, Date.now() + wait);
        pending.push(job); // requeue; stays in `tracked` (no double-enqueue)
        requeued = true;
      } else {
        // Non-retriable, or retries exhausted: drop it. The sweep re-heals a
        // game that ends up with no game_recaps row.
        console.error('gameRecap generation failed for %s:', job.gameId, err && err.message);
      }
    } finally {
      active -= 1;
      if (!requeued) tracked.delete(job.gameId);
      drain();
    }
  }

  function scheduleResume() {
    if (resumeTimer) return;
    const delay = Math.max(backoffUntil - Date.now(), 0) + 25;
    resumeTimer = setTimeout(() => {
      resumeTimer = null;
      drain();
    }, delay);
    if (resumeTimer.unref) resumeTimer.unref();
  }

  return {
    enqueue,
    has: (gameId) => tracked.has(gameId),
    stats: () => ({ active, pending: pending.length, tracked: tracked.size }),
  };
}

// The process-wide singleton the live engine and sweep both feed.
const recapQueue = createRecapQueue({
  worker: (gameId, opts) => generateForGame(gameId, opts),
});

/** Enqueue a recap generation (deduped, concurrency-bounded). */
function enqueueRecap(gameId, opts) {
  return recapQueue.enqueue(gameId, opts);
}

/**
 * Reconciliation sweep: find recent finalized games with no game_recaps row
 * and enqueue them. Time-bounded (recent `maxAgeDays` only) and LIMIT-capped so
 * it never rescans the whole season, and routed through the same queue as the
 * live trigger (with dedupe) so it can't become a thundering herd after a
 * restart. This is the safety net that heals games missed by a crash, a deploy
 * mid-window, or a dropped/failed live trigger — folding the manual backfill
 * into an automatic one.
 *
 * @param {{ enqueue?, maxAgeDays?, limit? }} opts  enqueue injectable for tests.
 * @returns {Promise<{ found: number, enqueued: number }>}
 */
async function reconcileRecaps({
  enqueue = enqueueRecap,
  maxAgeDays = SWEEP_MAX_AGE_DAYS,
  limit = SWEEP_LIMIT,
} = {}) {
  const res = await pool.query(
    `SELECT "lgs"."tank01_game_id"
       FROM "live_game_states" "lgs"
       LEFT JOIN ${RECAPS_TABLE_SQL} "gr" ON "gr"."tank01_game_id" = "lgs"."tank01_game_id"
      WHERE "lgs"."game_status" = 'final'
        AND (
          "gr"."tank01_game_id" IS NULL
          OR "gr"."generator_version" IS DISTINCT FROM $2
        )
        AND "lgs"."last_updated" >= now() - make_interval(days => $1)
      ORDER BY "lgs"."last_updated" DESC
      LIMIT $3`,
    [maxAgeDays, GENERATOR_VERSION, limit]
  );
  let enqueued = 0;
  for (const row of res.rows) {
    if (enqueue(row.tank01_game_id)) enqueued += 1;
  }
  return { found: res.rows.length, enqueued };
}

module.exports = {
  generateForGame,
  fetchTopPerformers,
  // queue + reconciliation sweep
  enqueueRecap,
  reconcileRecaps,
  createRecapQueue,
  retryAfterMs,
  // pure — unit tested
  normalizeLineScore,
  normalizeScoringPlays,
  countLeadChanges,
  templateNarrative,
  llmNarrative,
  serializeTopPerformer,
};
