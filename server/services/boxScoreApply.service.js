/**
 * Box-score apply: load a week's lookup maps, apply one game's box score into
 * player_stats, detect the Scoring plays a stat diff implies, the carried-stat
 * merge that protects nflverse-only keys across a wholesale stats rewrite,
 * which of a week's games still need a box fetch, and the Final-box-synced
 * stamp. Split out of scoring.service.js (#1504, spec #1492) as one of the
 * six modules the old scoring module now re-exports whole.
 *
 * Its own module: both the Live box path (modules/liveBox.js) and the
 * week-stats feed Sync run call applyGameBoxScore, so this is a seam in its
 * own right rather than living inside either caller.
 */
const pool = require('../modules/pool');
const { normalizeNflTeam } = require('./nflTeam');
const { calculateFantasyPoints } = require('./scoringRules');
const { upsertPlayerStats } = require('./playerStatsWrite.service');
const tank01BoxSource = require('./tank01BoxSource');

/**
 * Stat keys that ONLY nflverse can produce, so a Tank01 box-score apply — whose
 * upsert replaces the whole stats jsonb — must carry them forward instead of
 * silently erasing them.
 *
 * Three groups, all written by nflverseSync.service:
 *  - usage*: per-week opportunity/role columns (attempts, completions, carries,
 *    targets, air yards) from the combined weekly file. Unscored; the projection
 *    engine reads them as features, and their PRESENCE is the signal that role
 *    data exists at all, so a wipe reads as "we never knew", not "he sat".
 *  - gameTeam/gameOpponent: the team a stat line was earned for and against.
 *  - idp*Yards/idpSafety: the finalization patch (see nflverseSync's
 *    buildStatUpdates) — per-defender yardage Tank01's live feed has no field
 *    for at all.
 *
 * Deliberately NOT here: anything Tank01 does produce. This list is only for
 * keys the live feed cannot regenerate, so carrying them can never mask a stat
 * correction.
 *
 * Lives here (not nflverseSync) because nflverseSync already requires this
 * module; the reverse direction would be a require cycle.
 */
const NFLVERSE_ONLY_STAT_KEYS = [
  'usagePassAttempts',
  'usageCompletions',
  'usageCarries',
  'usageTargets',
  'usageAirYards',
  'usageOffenseSnaps',
  'usageOffenseSnapPct',
  'usageDefenseSnaps',
  'usageDefenseSnapPct',
  'gameTeam',
  'gameOpponent',
  'idpSackYards',
  'idpTacklesForLossYards',
  'idpFumbleReturnYards',
  'idpInterceptionReturnYards',
  'idpSafety',
];

/**
 * Pure: the subset of `keys` that are actually PRESENT on `source`, as a new
 * object, or null when there are none (or no source at all).
 *
 * "Present" means the property exists with a value other than undefined. An
 * explicit null IS carried: null is data here ("we looked and the column was
 * absent"), and the whole point of these keys is that a missing value must stay
 * missing rather than becoming 0. Never invents a key that isn't on the source.
 */
function pickPresentKeys(source, keys) {
  if (!source || typeof source !== 'object') return null;
  const out = {};
  let found = 0;
  for (const key of keys || []) {
    if (source[key] !== undefined) {
      out[key] = source[key];
      found += 1;
    }
  }
  return found > 0 ? out : null;
}

/**
 * Pure: a fresh stat line with carried keys filled in underneath it.
 *
 * Fresh always wins: a carried value is written only where the fresh object has
 * no defined value for that key, so a live Tank01 pull (including a stat
 * correction that lowers a number) can never be overridden by a stale carry.
 * Written as an explicit fill rather than `{ ...carried, ...fresh }` because
 * that spread would let an explicitly-undefined fresh key clobber a real
 * carried value.
 */
function mergeCarriedStats(fresh, carried) {
  const merged = { ...fresh };
  if (!carried) return merged;
  for (const [key, value] of Object.entries(carried)) {
    if (merged[key] === undefined) merged[key] = value;
  }
  return merged;
}

// Stat keys that represent a discrete, animatable "play" (a touchdown or a
// smaller impact play), mapped to the event type the live UI renders and
// whether it's touchdown-caliber (full-screen cutscene territory) or a
// lighter moment (flash-banner territory on the retro scoreboard only).
// Detection keys off the stat itself incrementing — never a fantasy-point
// jump — so a stat correction that moves points without a new play never
// fires an animation.
const PLAY_STAT_EVENTS = {
  passingTDs: { type: 'passing', isTouchdown: true },
  rushingTDs: { type: 'rushing', isTouchdown: true },
  receivingTDs: { type: 'receiving', isTouchdown: true },
  defensiveTD: { type: 'defensive', isTouchdown: true },
  returnTDs: { type: 'return', isTouchdown: true },
  fieldGoal: { type: 'fieldGoal', isTouchdown: false },
  extraPoint: { type: 'extraPoint', isTouchdown: false },
  sack: { type: 'sack', isTouchdown: false },
  interceptionReturn: { type: 'interception', isTouchdown: false },
  fumbleRecovery: { type: 'fumble', isTouchdown: false },
  puntReturns: { type: 'puntReturn', isTouchdown: false },
};

/**
 * Pure: diff a player's previous vs. new stat line and return one typed play
 * event per tracked stat that increased. Yardage and other untracked stat
 * changes produce nothing. `prevStats` null/undefined is treated as all-zero
 * (first observation of the week) — so re-running a sync with unchanged stats
 * yields no events (idempotent), but a genuinely new play does.
 *
 * Exported as a test-only seam (server/test/scoring.events.test.js), not
 * cross-module interface: no other module calls this directly.
 */
function detectScoringEvents(prevStats, newStats) {
  const prev = prevStats || {};
  const next = newStats || {};
  const events = [];
  for (const [statKey, { type, isTouchdown }] of Object.entries(PLAY_STAT_EVENTS)) {
    const before = Number(prev[statKey]) || 0;
    const after = Number(next[statKey]) || 0;
    if (after > before) {
      events.push({ type, statKey, tdDelta: after - before, isTouchdown });
    }
  }
  return events;
}

// A tracked event's own `statKey` (PLAY_STAT_EVENTS, above) is not always the
// key calculateFantasyPoints actually prices from. `fieldGoal` is a plain
// make-count (Tank01's fgMade) with no rate of its own in STAT_KEY_PATHS —
// a made kick's real price lives on `fieldGoalDistances`, the per-make
// distance array scoreTieredValues tier-matches, so it needs this redirect.
// `puntReturns` has the opposite shape: it has no STAT_KEY_PATHS entry AT ALL
// (only `puntReturnYards` does, defaulting to a 0 rate) - unmapped, it prices
// at a marginal of 0 and whatever it's actually worth (yardage, if a
// commissioner has priced it) lands in the residual, same as any other
// untracked stat. Every other tracked event key already prices itself
// directly (the TD counters, teamDefense's sack/interceptionReturn/
// fumbleRecovery/defensiveTD, misc's returnTDs, kicking's extraPoint) - only
// field goals need the redirect below.
const EVENT_PRICING_KEY = { fieldGoal: 'fieldGoalDistances' };

/**
 * Pure: split one player's whole per-sync points change (`wholeDelta`,
 * already priced by the caller as `calculateFantasyPoints(next) -
 * calculateFantasyPoints(prev)`) across the several tracked events one sync
 * produced for them, so the returned deltas SUM to `wholeDelta` instead of
 * each one carrying it whole.
 *
 * Each event's own marginal prices ONLY the one stat key it actually scores
 * from (EVENT_PRICING_KEY's redirect for field goals, the event's own
 * `statKey` otherwise), moved from `prev`'s value to `next`'s, against an
 * otherwise-unchanged `prev` line — the value that one make/score is worth
 * on its own. Whatever that leaves over against the true whole change
 * (yardage, length/yardage bonuses, a DEF points-allowed/yards-allowed tier
 * move — nothing tied to a single tracked stat key) is folded as a residual
 * onto the LAST event, so the returned deltas always sum to `wholeDelta`
 * exactly (worked in integer cents so the rounding is exact, never
 * approximate). Last, not first: PLAY_STAT_EVENTS orders touchdown keys
 * before the non-touchdown ones, so a first-event residual would routinely
 * land the fuzzy leftover (or, on a tier drop, a negative one) on the
 * touchdown play - the cutscene surfaces read. Putting it last instead keeps
 * a touchdown play's own clean marginal whenever a later, non-touchdown event
 * exists to absorb the remainder.
 *
 * A single event returns `[wholeDelta]` unchanged (today's one-play-per-sync
 * shape, still the overwhelmingly common case) — the marginal split only
 * runs when there is more than one event to split across. Zero events
 * returns `[]`.
 *
 * Exported as a test-only seam (server/test/scoring.events.test.js), not
 * cross-module interface: no other module calls this directly.
 *
 * @param {object} prev  the player's stat line before this sync (null/undefined reads as all-zero)
 * @param {object} next  the player's stat line after this sync
 * @param {Array<{statKey: string}>} events  detectScoringEvents' output for this diff
 * @param {number} wholeDelta  the player's whole, already-rounded points change for the sync
 * @returns {number[]} one pointsDelta per event, same order as `events`, summing to `wholeDelta`
 */
function attributePlayPoints(prev, next, events, wholeDelta) {
  if (!events || events.length === 0) return [];
  if (events.length === 1) return [wholeDelta];
  const base = prev || {};
  const after = next || {};
  const baseScore = calculateFantasyPoints(base);
  const marginalCents = events.map((ev) => {
    const pricingKey = EVENT_PRICING_KEY[ev.statKey] || ev.statKey;
    const withOne = { ...base, [pricingKey]: after[pricingKey] };
    return Math.round((calculateFantasyPoints(withOne) - baseScore) * 100);
  });
  const wholeCents = Math.round(wholeDelta * 100);
  const sumCents = marginalCents.reduce((s, c) => s + c, 0);
  const last = marginalCents.length - 1;
  marginalCents[last] += wholeCents - sumCents; // residual, exact in integer cents
  return marginalCents.map((c) => c / 100);
}

/**
 * The rostered DEF (team-defense) units, keyed by Team code, for matching a
 * box score's team-level DST aggregate.
 *
 * Team-defense units have no external_id — Tank01's player list never reports
 * them as individual entries — so they are matched by team rather than by id.
 * The key is the Team code (folded through normalizeNflTeam), NOT the local
 * normalizeTeamAbbr: a DEF row's nfl_team is a full name (`Washington
 * Commanders`) and a box score's teamAbv is Tank01's raw code (`WSH`), two
 * different vocabularies that only meet once both fold to the canonical WAS.
 * normalizeTeamAbbr short-circuits on an already-abbreviated input, so it would
 * leave WSH as WSH and never reconcile it with WAS (the #431 bug).
 *
 * ONE builder, shared by both DEF-scoring paths — the live box-score apply
 * (loadWeekMaps, below) and the nflverse finalization (syncNflverseCorrection) —
 * so the keying rule lives in exactly one place and the two paths cannot drift.
 * Each caller looks the map up by folding ITS box-score/stat side through
 * normalizeNflTeam the same way, and reads what it needs off the row (the live
 * path needs the name for the cutscene; nflverse needs only the id).
 */
async function loadDefUnitsByTeamCode() {
  const defPlayers = await pool.query(
    `SELECT "id", "name", "nfl_team" FROM "players" WHERE "position" = 'DEF'`
  );
  const byTeamCode = new Map();
  for (const row of defPlayers.rows) {
    const teamCode = normalizeNflTeam(row.nfl_team);
    if (teamCode) byTeamCode.set(teamCode, row);
  }
  return byTeamCode;
}

/**
 * Every lookup table a box-score apply needs for one (season, week), loaded
 * once and reused across the week's games.
 */
async function loadWeekMaps({ season, week }) {
  const knownPlayers = await pool.query(
    `SELECT "id", "external_id", "name", "position", "nfl_team"
     FROM "players" WHERE "external_id" IS NOT NULL`
  );
  const idByExternal = new Map(
    knownPlayers.rows.map((r) => [String(r.external_id), r.id])
  );
  const metaById = new Map(knownPlayers.rows.map((r) => [r.id, r]));

  // The DEF-unit map, keyed by Team code (see loadDefUnitsByTeamCode). The
  // lookup in applyGameBoxScore folds the box score's raw teamAbv the same way.
  const defByTeamCode = await loadDefUnitsByTeamCode();

  // Prior stats for this week, so we can diff for new touchdowns.
  const priorStats = await pool.query(
    `SELECT "player_id", "stats" FROM "player_stats"
     WHERE "season" = $1 AND "week" = $2`,
    [season, week]
  );
  const prevById = new Map(priorStats.rows.map((r) => [r.player_id, r.stats]));

  // This week's real-game opponents, keyed by nfl_team, for the defender sprite.
  const schedule = await pool.query(
    `SELECT "nfl_team", "opponent" FROM "nfl_games"
     WHERE "season" = $1 AND "week" = $2`,
    [season, week]
  );
  const opponentByTeam = new Map(schedule.rows.map((r) => [r.nfl_team, r.opponent]));

  return { idByExternal, metaById, defByTeamCode, prevById, opponentByTeam };
}

/**
 * Ingest ONE game's Live box (or Final box) into player_stats: every player in
 * the game whose external_id we know, plus both team-defense lines.
 *
 * This is the consumer side of the Box source seam (#1183, ADR 0035). It reads
 * ONLY the source-neutral Live box shape that tank01BoxSource.fromBox and
 * espnBoxSource produce; nothing here knows a Tank01 or ESPN field name. A raw
 * Tank01 `box` is still accepted and adapted here so the callers and tests that
 * predate the seam are unchanged.
 *
 * Extracted from syncWeekStats so a single box-score fetch can serve more than
 * one purpose: gameRecap.generateForGame calls this with the box it already
 * fetched for the recap, which is what eliminates the duplicate final-game
 * fetch (~69 calls/month of pure waste).
 *
 * Returns the typed Scoring plays (`plays`) detected by diffing each player's
 * prior stored stats against this pull, decorated with the scoring player's
 * Team code and that week's opponent so the live UI can render a team-accurate
 * cutscene. Only genuine stat increments produce a play, so a re-sync or a stat
 * correction never fabricates one.
 *
 * @param {object} args
 * @param {object} [args.liveBox]  neutral Live box (tank01BoxSource / espnBoxSource)
 * @param {object} [args.box]      unwrapped Tank01 /getNFLBoxScore body (adapted here)
 * @param {object} args.maps       from loadWeekMaps({ season, week })
 * @param {boolean} [args.suppressPlays]  write stats but emit no Scoring plays
 *   (the switch-pass rule, ADR 0035: the first apply after a source change,
 *   including the Final box landing, must not replay a touchdown cutscene)
 * @param {object} [args.client]  a checked-out transaction client (ADR 0033);
 *   defaults to the ambient pool for every caller outside a Sync run's own
 *   per-unit transaction (the Live box poll, the recap path, and every test
 *   that predates the week-stats Sync run migration, #1202) - unchanged.
 */
async function applyGameBoxScore({ liveBox, box, season, week, maps, suppressPlays = false, client = pool }) {
  const { idByExternal, metaById, defByTeamCode, prevById, opponentByTeam, finalSyncedGameIds } = maps;
  const live = liveBox || tank01BoxSource.fromBox(box);
  // Final guard (#1186, ADR 0035): once the Final box has landed for a game
  // (final_stats_synced_at set), no Live box write is accepted for it. A late
  // ESPN poll cannot overwrite the numbers a settled week prices from. The
  // caller supplies the set (the engine reads it off live_game_states); a
  // caller without one, the Final box path included, is not guarded here.
  if (live.gameId && finalSyncedGameIds && finalSyncedGameIds.has(String(live.gameId))) {
    console.log('applyGameBoxScore: Final box already landed for %s; skipping a %s Live box', live.gameId, live.source);
    return { updated: 0, plays: [], skipped: 'final-box-landed' };
  }
  let updated = 0;
  const plays = [];

  // The funnel scores the row it stores; that one score is also the one a
  // sync's plays' pointsDelta values are priced from, so the two can never
  // disagree. The pointsDelta values of ONE sync's plays for a player add up
  // to that player's whole points change for the sync (attributePlayPoints);
  // consumers SUM them. One score event can carry plays from more than one
  // sync (liveBoxPoll's rescore gate buckets a league's plays across 30s
  // engine ticks and flushes on a 60s floor), so consumers must never dedupe
  // per player.
  const upsertStats = async (playerId, stats) => {
    const { fantasyPoints } = await upsertPlayerStats(client, { playerId, season, week, stats });
    // Keep the diff baseline current so a re-apply of the same box (the recap
    // path following a live sync) can't re-fire the same touchdown.
    prevById.set(playerId, stats);
    updated += 1;
    return fantasyPoints;
  };

  for (const player of live.players || []) {
    const playerId = idByExternal.get(String(player.externalId));
    if (!playerId) continue; // not in our pool
    const prev = prevById.get(playerId);
    // This upsert replaces the stats jsonb wholesale, so anything only nflverse
    // can supply has to ride across from the stored row or it's gone until the
    // next backfill. Merged BEFORE points are computed and before the row is
    // written, so the stored fantasy_points always describes the stored stats.
    const stats = mergeCarriedStats({ ...player.stats }, pickPresentKeys(prev, NFLVERSE_ONLY_STAT_KEYS));
    const points = await upsertStats(playerId, stats);
    const events = suppressPlays ? [] : detectScoringEvents(prev, stats);
    if (events.length > 0) {
      const meta = metaById.get(playerId) || {};
      const wholeDelta =
        Math.round((points - calculateFantasyPoints(prev || {})) * 100) / 100;
      const deltas = attributePlayPoints(prev, stats, events, wholeDelta);
      // The opponent map is keyed by the raw `nfl_games.nfl_team` and looked up
      // with the raw `meta.nfl_team` (its partner): that pairing stays raw-on-raw
      // (#431). The play object it feeds is a different contract: `nflTeam` and
      // `opponent` on a Scoring play are Team codes (CONTEXT.md **Team code**),
      // so both are folded through normalizeNflTeam before they leave the server.
      const rawOpponent = opponentByTeam.get(meta.nfl_team) || null;
      events.forEach((ev, i) => {
        plays.push({
          playerId,
          name: meta.name,
          position: meta.position,
          nflTeam: normalizeNflTeam(meta.nfl_team),
          opponent: rawOpponent ? normalizeNflTeam(rawOpponent) : null,
          type: ev.type,
          tdDelta: ev.tdDelta,
          pointsDelta: deltas[i],
          isTouchdown: ev.isTouchdown,
        });
      });
    }
  }

  // Team-defense scoring: one aggregate line per side, keyed by Team code. A
  // rostered DEF unit has no external_id (no feed reports one as a player), so
  // it is matched by Team code, the one vocabulary both sides fold to (#431).
  // The opponent map is keyed by nfl_games' RAW spelling (WSH), so it is folded
  // once here into a Team-code lookup rather than probed with a raw code.
  const opponentByTeamCode = new Map();
  for (const [rawTeam, rawOpponent] of opponentByTeam.entries()) {
    const code = normalizeNflTeam(rawTeam);
    if (code && !opponentByTeamCode.has(code)) opponentByTeamCode.set(code, rawOpponent);
  }
  for (const [teamCode, line] of Object.entries(live.teamDefense || {})) {
    const defPlayer = defByTeamCode.get(teamCode);
    if (!defPlayer) continue; // no rostered DEF unit for this team in our pool
    const prev = prevById.get(defPlayer.id);
    // Same wholesale-replace hazard as the player loop above: a DST row
    // backfilled from nflverse carries gameTeam/gameOpponent that a live
    // aggregate has no equivalent for.
    const stats = mergeCarriedStats({ ...line }, pickPresentKeys(prev, NFLVERSE_ONLY_STAT_KEYS));
    const points = await upsertStats(defPlayer.id, stats);
    const events = suppressPlays ? [] : detectScoringEvents(prev, stats);
    if (events.length > 0) {
      const wholeDelta =
        Math.round((points - calculateFantasyPoints(prev || {})) * 100) / 100;
      const deltas = attributePlayPoints(prev, stats, events, wholeDelta);
      const rawOpponent = opponentByTeamCode.get(teamCode) || null;
      events.forEach((ev, i) => {
        plays.push({
          playerId: defPlayer.id,
          name: defPlayer.name,
          position: 'DEF',
          nflTeam: teamCode,
          opponent: rawOpponent ? normalizeNflTeam(rawOpponent) : null,
          type: ev.type,
          tdDelta: ev.tdDelta,
          pointsDelta: deltas[i],
          isTouchdown: ev.isTouchdown,
        });
      });
    }
  }

  return { updated, plays };
}

/**
 * Pure: which of a week's games still need a box-score fetch.
 *
 * This is the second-biggest quota saving in the app. The old loop box-scored
 * every game in the week on every ~30-minute pass, so a finished 1pm game was
 * re-fetched for the rest of the afternoon (~350 calls/Sunday). Now:
 *  - `scheduled` games have no stats yet — never fetch
 *  - `final` games already ingested (final_stats_synced_at set) — never again
 *  - `in_progress` games are the Live box, read by the clock engine's loop
 *    through the Box source seam (modules/liveBoxPoll, ADR 0035), not here
 *  - finals not yet ingested are the only fetches: the Final box (#1185)
 *
 * @param {Array<{tank01_game_id: string, game_status: string, final_stats_synced_at: ?Date}>} rows
 * @returns {Array<{gameId: string, status: string, isFinal: boolean}>}
 */
function gamesNeedingBoxScore(rows) {
  const out = [];
  for (const row of rows || []) {
    const gameId = row.tank01_game_id;
    if (!gameId) continue;
    const status = row.game_status;
    if (status !== 'final') continue;
    if (row.final_stats_synced_at) continue;
    out.push({ gameId, status, isFinal: true });
  }
  return out;
}

/**
 * Stamp a finalized game as stat-ingested. Idempotent, and deliberately
 * separate from the recap row: a recap can be regenerated without re-spending a
 * box-score call, and a stat re-sync (admin/correction route) can clear the
 * stamp if it ever needs to.
 *
 * `client` defaults to the ambient pool for every caller outside a Sync run's
 * per-unit transaction; syncWeekStats' own apply (feedSyncRuns.service.js)
 * passes its unit's transaction client so the stamp commits or rolls back with
 * that game's stats.
 */
async function markFinalStatsSynced(tank01GameId, client = pool) {
  await client.query(
    `UPDATE "live_game_states" SET "final_stats_synced_at" = now(), "updated_at" = now()
      WHERE "tank01_game_id" = $1`,
    [tank01GameId]
  );
}

module.exports = {
  loadDefUnitsByTeamCode,
  loadWeekMaps,
  applyGameBoxScore,
  gamesNeedingBoxScore,
  markFinalStatsSynced,
  NFLVERSE_ONLY_STAT_KEYS,
  pickPresentKeys,
  mergeCarriedStats,
  detectScoringEvents,
  attributePlayPoints,
};
