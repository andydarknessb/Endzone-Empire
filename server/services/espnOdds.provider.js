const axios = require('axios');
const pool = require('../modules/pool');
const { runSyncJob } = require('../modules/syncRun');
const { ESPN_SCOREBOARD_URL, espnAbbrToOurs } = require('../modules/espnScoreboard');
const { buildGameKey } = require('./scoring.service');

/**
 * The ESPN implementation of the odds provider seam (`vegasOdds.provider.js`,
 * ADR 0037): the free NFL scoreboard's `odds[]` block is the market source,
 * fetched hourly as its own Sync run (ADR 0036) and read back through the
 * seam from the snapshot table it writes — never from a live endpoint at
 * projection time (see vegasOdds.provider.js's own "ODDS MOVE" note: a
 * provider queried at two different moments can answer two different
 * numbers, which is exactly what the snapshot table exists to pin down).
 *
 * Two halves live in this one file because they are one feature end to end:
 * - `syncOdds` / `fetchOddsUnits` / `applyOddsUnit`: the Sync run that reads
 *   the week's scoreboard once and writes one `game_odds_snapshots` row per
 *   game that actually carries an odds block.
 * - `espnOddsProvider` / `getWeeklyOdds`: the seam implementation the
 *   projection engine calls, reading the newest snapshot per game back out.
 *
 * ESPN's scoreboard needs no key and is not quota-metered (unlike Tank01), so
 * this job has no credential gate and no quota concern — it is safe to call
 * more often than strictly necessary.
 */

const ESPN_TIMEOUT_MS = Number(process.env.ESPN_TIMEOUT_MS) || 10000;
const ESPN_ODDS_SOURCE = 'espn';

/** Same guard as vegasOdds.provider.js's own — duplicated rather than shared so this boundary carries no dependency on that one either. `Number(null)` is 0, so a naive finite check would turn a missing field into a measured zero. */
function isNum(v) {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return false;
  return Number.isFinite(Number(v));
}

/**
 * Pure: the HOME team's signed spread from one odds entry's `details` string
 * ("MIA -3.5", "BUF +3.5", "EVEN"/"PK" for a pick-em), or null when it cannot
 * be resolved against one of the two known teams. Deliberately never reads
 * the entry's raw `spread` field: ESPN does not document which side that
 * number is signed relative to, while `details` names the favored team
 * explicitly — and a wrong-signed guess would be worse than no line at all.
 */
function resolveHomeSpread(entry, { homeTeam, awayTeam }) {
  const details = String((entry && entry.details) || '').trim().toUpperCase();
  if (!details) return null;
  if (details === 'EVEN' || details === 'PK') return 0;
  const match = details.match(/^([A-Z]{1,4})\s*([+-]?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const favored = espnAbbrToOurs(match[1]);
  const magnitude = Math.abs(Number(match[2]));
  if (!favored || !Number.isFinite(magnitude)) return null;
  if (favored === homeTeam) return -magnitude;
  if (favored === awayTeam) return magnitude;
  return null; // the named team is neither side of this game — untrustworthy, never guess
}

/**
 * Pure: one ESPN competition's `odds[]` block -> `{ total, spread }`, or null
 * when the block is absent or carries nothing usable — never a fabricated
 * zero line for a game the book has not priced (issue #1234, criterion 1).
 * The first entry is the one used (ESPN's own consensus/primary line); a book
 * that has posted a total but pulled the spread (or vice versa) is a real,
 * honest half-quote, same as vegasOdds.provider.js already treats one.
 */
function parseCompetitionOdds(competition, { homeTeam, awayTeam }) {
  const entry = competition && Array.isArray(competition.odds) ? competition.odds[0] : null;
  if (!entry) return null;
  const total = isNum(entry.overUnder) ? Number(entry.overUnder) : null;
  const spread = resolveHomeSpread(entry, { homeTeam, awayTeam });
  if (total === null && spread === null) return null;
  return { total, spread };
}

/**
 * `fetch()` for the odds Sync run (ADR 0036): hits the free scoreboard once
 * for the whole week's slate, outside any transaction, and returns ONE unit —
 * every game that carries a usable odds block, keyed by the SAME `game_key`
 * format `nfl_games`/`game_odds_snapshots` already use (`buildGameKey`,
 * scoring.service.js). Built directly from the scoreboard's own season/week
 * and the game's home/away teams — no `nfl_games` lookup needed, unlike
 * espnScoreboard.js's tank01GameId (which is date-derived and needs
 * re-dating against the stored kickoff; a game_key is not date-based).
 * An event with no odds block, or whose teams don't normalize, is silently
 * skipped — never written as a zero line. Zero usable games (nobody has
 * posted lines yet) is not a failure: it resolves to an ok run with nothing
 * to write, not a refusal — refusal is this codebase's word for "the feed
 * answered but the data was too thin to trust", and an empty market this
 * early in the week is an expected state, not a data-quality problem.
 */
async function fetchOddsUnits({ season, week, transport }) {
  const client = transport || axios;
  const response = await client.get(ESPN_SCOREBOARD_URL, {
    params: { week, seasontype: 2, dates: season },
    timeout: ESPN_TIMEOUT_MS,
  });
  const events = response.data && Array.isArray(response.data.events) ? response.data.events : [];
  const quotes = [];
  for (const event of events) {
    const competition = event && Array.isArray(event.competitions) ? event.competitions[0] : null;
    if (!competition) continue;
    const competitors = Array.isArray(competition.competitors) ? competition.competitors : [];
    const home = competitors.find((c) => c && c.homeAway === 'home');
    const away = competitors.find((c) => c && c.homeAway === 'away');
    const homeTeam = home && espnAbbrToOurs(home.team && home.team.abbreviation);
    const awayTeam = away && espnAbbrToOurs(away.team && away.team.abbreviation);
    if (!homeTeam || !awayTeam) continue;
    const line = parseCompetitionOdds(competition, { homeTeam, awayTeam });
    if (!line) continue; // no odds block — nothing for this game, not a zero line
    const gameKey = buildGameKey({ season, week, away: awayTeam, home: homeTeam });
    if (!gameKey) continue;
    quotes.push({ gameKey, season, week, total: line.total, spread: line.spread });
  }
  return quotes.length > 0 ? [{ quotes }] : [];
}

/**
 * `apply(client, unit)` for the odds Sync run: writes every quote from the
 * one unit `fetchOddsUnits` produced, inside the single transaction
 * `runSyncJob` opens for it (ADR 0036, ADR 0037: "writes one odds snapshot
 * per game inside it" — one transaction for the whole slate, not one per
 * game). `observed_at` is the DATABASE clock (`now()`), not the app process
 * clock: Postgres resolves `now()` to the transaction's start time, so every
 * row this unit writes shares one instant, and reading it off the DB rather
 * than `new Date()` means the web and worker processes (which can both run
 * this job, qa-reviewer #1234 finding 3) can never disagree about ordering
 * from their own clock skew — the read path's `ORDER BY observed_at DESC`
 * only has to trust one clock. `ON CONFLICT DO NOTHING` on the table's own
 * unique constraint (game_key, source, observed_at) makes a byte-identical
 * re-fetch inside the same transaction-instant a no-op rather than an error;
 * a genuine line move gets its own row because a later run's `now()` is a
 * later transaction.
 */
async function applyOddsUnit(client, { quotes }) {
  for (const quote of quotes) {
    await client.query(
      `INSERT INTO "game_odds_snapshots"
         ("season", "week", "game_key", "source", "observed_at", "total", "spread")
       VALUES ($1, $2, $3, $4, now(), $5, $6)
       ON CONFLICT ("game_key", "source", "observed_at") DO NOTHING`,
      [quote.season, quote.week, quote.gameKey, ESPN_ODDS_SOURCE, quote.total, quote.spread]
    );
  }
  return { gamesWritten: quotes.length };
}

/**
 * Run the odds Sync run for one (season, week) slate. No advisory lock:
 * `game_odds_snapshots` has exactly one writer (ADR 0036: "a job that writes
 * a table nobody else bulk-writes takes none"). `transport` is test-injected;
 * production calls hit ESPN's free scoreboard directly, same as
 * espnScoreboard.js.
 */
async function syncOdds({ season, week, transport } = {}) {
  return runSyncJob({
    job: 'odds',
    lock: null,
    fetch: () => fetchOddsUnits({ season, week, transport }),
    apply: (client, unit) => applyOddsUnit(client, unit),
  });
}

/**
 * The seam's `getWeeklyOdds({ season, week, client })` (vegasOdds.provider.js
 * / projection.service.js's `generateProjections`): the newest snapshot per
 * game for the week, never an older one once a newer exists (issue #1234,
 * criterion 3). One round trip via `DISTINCT ON`, ordered newest-first per
 * game, rather than one query per game. Filtered to this provider's OWN
 * `source` (qa-reviewer #1234 finding 4): the table's unique constraint
 * allows a second source to write the same game_key/observed_at pair, and
 * without this filter a future second provider's row could win the
 * newest-per-game pick here and be mislabeled `espn`. `row.source` is read
 * back rather than assumed for the same reason — it happens to always be
 * `ESPN_ODDS_SOURCE` today only because the WHERE clause guarantees it.
 */
async function getWeeklyOdds({ season, week, client } = {}) {
  const db = client || pool;
  const result = await db.query(
    `SELECT DISTINCT ON ("game_key") "game_key", "total", "spread", "observed_at", "source"
     FROM "game_odds_snapshots"
     WHERE "season" = $1 AND "week" = $2 AND "source" = $3
     ORDER BY "game_key", "observed_at" DESC`,
    [season, week, ESPN_ODDS_SOURCE]
  );
  const map = new Map();
  for (const row of result.rows) {
    map.set(row.game_key, {
      total: row.total == null ? null : Number(row.total),
      spread: row.spread == null ? null : Number(row.spread),
      source: row.source,
      // vegasOdds.provider.js's GameOdds typedef documents this as an
      // ISO-8601 STRING; `pool.js` installs no pg type parser for
      // timestamptz, so `row.observed_at` arrives as a JS Date and must be
      // converted on the way out (formal review, PR #1259 f1) rather than
      // passed through the way decisionCardContext.service.js's loadLine
      // does for its own unrelated, string-vs-Date-indifferent JSON response.
      observedAt: row.observed_at == null ? null : new Date(row.observed_at).toISOString(),
    });
  }
  return map;
}

/** The provider object installed via `setVegasOddsProvider` at boot (server.js, worker.js). */
const espnOddsProvider = {
  name: ESPN_ODDS_SOURCE,
  available: true,
  getWeeklyOdds,
};

module.exports = {
  ESPN_ODDS_SOURCE,
  resolveHomeSpread,
  parseCompetitionOdds,
  fetchOddsUnits,
  applyOddsUnit,
  syncOdds,
  getWeeklyOdds,
  espnOddsProvider,
};
