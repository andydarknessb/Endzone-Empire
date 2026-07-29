const pool = require('../modules/pool');
const { calculateFantasyPoints, normalizeTeamAbbr } = require('./scoring.service');
const { computeByeWeeks } = require('./bye.service');
const model = require('./projectionModel');

/**
 * Feature extraction for the weekly projection engine.
 *
 * Split from projection.service.js so the ENGINE (cache identity, run
 * bookkeeping, the public API) and the FEATURES (what the model gets to look
 * at) can be reviewed and tested independently.
 *
 * Three invariants hold everywhere in this file:
 *
 * 1. **Input cutoff.** Nothing loaded here may postdate the target week's
 *    kickoff. Current-season stats are filtered to `week < W` in SQL, opponent
 *    allowances are computed from `week < W` only, and prior seasons are
 *    complete by definition. There is no code path that reads week W's own
 *    stats, and `assertNoFutureRows` is exported so tests can prove it.
 * 2. **League scoring.** Every historical stat line is re-priced through
 *    `calculateFantasyPoints(stats, rules)` with the VIEWING league's rules.
 *    The stored `fantasy_points` column (default half-PPR) is never read as an
 *    authoritative value.
 * 3. **Missing stays missing.** A player, defense or split with no data yields
 *    `null` / an unavailable factor, never a zero that reads like a
 *    measurement.
 *
 * Batching: one query per CONCEPT for the whole request, never one per player.
 */

// How many completed seasons back the weekly history window reaches. Two is
// enough for a Week 1 veteran baseline without dragging a 3-year-old role into
// a current projection.
const HISTORY_SEASONS = 2;

// Guard rail on the league-wide opportunity scan (opponent allowance, position
// baselines, home/away splits). A normal season-to-date scan for the positions
// on one roster is a few thousand rows; this only trips if something upstream
// asks for an implausible window, in which case the affected factors report
// themselves unavailable rather than the request timing out.
const MAX_LEAGUE_SCAN_ROWS = 60000;

// See projectionModel.isNum: `Number(null)` is 0, so a naive finite check
// silently converts missing evidence into a measured zero.
function isNum(v) {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return false;
  return Number.isFinite(Number(v));
}

/** Pure: how many "recency weeks" separate a historical game from the target week. */
function weeksAgo({ gameSeason, gameWeek, season, week, seasonWeekSpan = model.MODEL_CONSTANTS.baseline.seasonWeekSpan }) {
  const seasonGap = Number(season) - Number(gameSeason);
  return seasonGap * seasonWeekSpan + (Number(week) - Number(gameWeek));
}

/**
 * Pure: assert a set of stat rows contains nothing at or after the prediction
 * cutoff. Exported so the "future weeks cannot enter the feature set" test can
 * assert on the real filter rather than a re-implementation of it.
 */
function assertNoFutureRows(rows, { season, week }) {
  for (const row of rows || []) {
    const s = Number(row.season);
    const w = Number(row.week);
    if (s > Number(season) || (s === Number(season) && w >= Number(week))) {
      throw new Error(
        `projection input cutoff violated: row for season ${s} week ${w} is not before ${season} week ${week}`
      );
    }
  }
  return true;
}

/** Pure: usage/opportunity keys nflverse can supply. Presence marks "we know his role". */
const ROLE_KEYS = [
  'usagePassAttempts',
  'usageCompletions',
  'usageCarries',
  'usageTargets',
  'usageAirYards',
  'receptions',
];

function hasRoleSignal(stats) {
  if (!stats || typeof stats !== 'object') return false;
  return ROLE_KEYS.some((key) => stats[key] != null);
}

/**
 * Legacy / alternate NFL abbreviations, mirroring the alias branch of
 * `fn_normalize_nfl_team` (server/db/migrations/20260719000003_view_matchup_nfl_games.js).
 * Kept in sync with that list by hand, the same way scoring.service's team-name
 * map already is.
 */
const TEAM_KEY_ALIASES = {
  WSH: 'WAS', WFT: 'WAS', GNB: 'GB', KAN: 'KC', JAC: 'JAX', NWE: 'NE',
  NOR: 'NO', TAM: 'TB', SFO: 'SF', SD: 'LAC', OAK: 'LV', STL: 'LAR', LA: 'LAR',
};

/**
 * Pure: a team spelling -> the SAME canonical key `fn_normalize_nfl_team`
 * produces in SQL, or null.
 *
 * Every schedule key in this file is normalized by that SQL function, so a team
 * read out of JS (a stored `gameTeam`, a player's team) has to be folded the
 * same way before it is compared against one: nflverse writes WAS where the
 * schedule may hold WSH, and treating those as two teams would either miss a
 * real match or, worse, report a contradiction that is only a spelling.
 */
function normalizeTeamKey(team) {
  const raw = String(team == null ? '' : team).trim().toUpperCase();
  if (!raw) return null;
  const abbr = normalizeTeamAbbr(raw) || raw;
  return TEAM_KEY_ALIASES[abbr] || abbr;
}

/**
 * Pure: an `nfl_games` row's home/away orientation as a boolean, or null when
 * the row has none to report.
 *
 * Every schedule source designates a nominal home team for a NEUTRAL-SITE game
 * as well — the row has to have a shape, and nflverse's games.csv marks the
 * distinction only in its separate `location` column, which the sync carries
 * through as `neutral_site` (see nflverseSync.buildScheduleRows). That
 * designation is bookkeeping, not a crowd: nobody played a home game in London
 * or Munich, so a neutral game has NO orientation and must never reach a factor
 * that prices home-field advantage. Returning null here is what makes that
 * true at every call site at once instead of at each one that remembers.
 *
 * `neutral_site` null means UNKNOWN, and unknown is treated as not-neutral on
 * purpose: it is what every production row carries today, so this read is
 * identical to the bare `home_away` test it replaces until orientation data
 * actually exists.
 */
function scheduleOrientation(row) {
  if (!row || row.neutral_site === true) return null;
  if (row.home_away === 'home') return true;
  if (row.home_away === 'away') return false;
  return null;
}

/**
 * Pure: the opportunity counts a stored stat line carries, in the shape
 * projectionModel.opportunitiesForGame reads.
 *
 * Null-preserving in the strict sense: an absent key, a null, or anything
 * non-numeric becomes `null`, never 0. A genuine stored 0 (he dressed and
 * touched the ball zero times) stays 0, because that one IS a measurement.
 * Rows written before the usage enrichment landed simply produce three nulls,
 * which is what lets the whole component degrade to "contributes nothing"
 * instead of "his role collapsed".
 */
function usageFromStats(stats) {
  const read = (key) => (stats && isNum(stats[key]) ? Number(stats[key]) : null);
  return {
    passAttempts: read('usagePassAttempts'),
    carries: read('usageCarries'),
    targets: read('usageTargets'),
  };
}

// ---------------------------------------------------------------------------
// Pure builders (no DB) — the DB layer below just hands them rows.
// ---------------------------------------------------------------------------

/**
 * Pure: a player's prior league-scored games, newest first, annotated with
 * recency distance and the opponent they were played against (when the
 * schedule can be resolved for that exact season/week).
 *
 * WHICH TEAM a historical line belongs to is the whole difficulty. A
 * current-season row is resolved through the player's CURRENT team, which is
 * what the schedule map has always been keyed by. A prior-season row can only
 * be resolved through the team he played for THAT week, which exists solely as
 * the `gameTeam` key the nflverse backfill wrote into player_stats.stats, so
 * reading it is gated behind `constants` (see MODEL_CONSTANTS.homeAway
 * .useStoredHistory and .versusOpponent.crossSeason), both of which ship false.
 * At the shipped values this function returns exactly what it returned before
 * the stored keys existed. Rows with no `gameTeam` are unaffected at ANY
 * setting: a prior-season game with no stored team stays opponent/isHome null
 * rather than being resolved through whatever team the player is on today.
 *
 * `constants` carries the RUN's constants: projection.service.projectFromBundle
 * hands its per-run object down, so a backtest sweep of the gates reaches this
 * function through the ordinary engine path. The default is the shipped
 * MODEL_CONSTANTS, which is what a caller passing nothing has always got.
 */
function buildPriorGames({
  statRows, rules, season, week, opponentByTeamWeek, playerTeam,
  constants = model.MODEL_CONSTANTS,
}) {
  const crossSeason = !!(constants && constants.versusOpponent && constants.versusOpponent.crossSeason);
  const useStoredHistory = !!(constants && constants.homeAway && constants.homeAway.useStoredHistory);
  const currentTeamKey = normalizeTeamKey(playerTeam);
  const games = [];
  for (const row of statRows || []) {
    const points = calculateFantasyPoints(row.stats, rules);
    // Whether this game belongs to the season being projected. Two consumers
    // care: the opponent/orientation fields below, and the model's optional
    // current-season blend, which averages THIS season's games only.
    const sameSeason = Number(row.season) === Number(season);
    const stats = row.stats && typeof row.stats === 'object' ? row.stats : {};
    const storedTeam = normalizeTeamKey(stats.gameTeam);
    const storedOpponent = normalizeTeamKey(stats.gameOpponent);
    // One resolution path, two ways of choosing the team it looks up: the
    // current season keeps the current-team key it has always used, and an
    // earlier season uses the stored per-week team or nothing. The two agree on
    // a current-season row unless the player was traded mid-season, and that
    // disagreement is caught below rather than resolved by preference.
    const teamKey = sameSeason
      ? currentTeamKey
      : ((crossSeason || useStoredHistory) ? storedTeam : null);
    const resolved = teamKey && opponentByTeamWeek
      ? opponentByTeamWeek.get(`${row.season}:${row.week}:${teamKey}`) || null
      : null;
    // Two independent records of who this line was earned against. When they
    // disagree, one of them is wrong and nothing here can say which, so the
    // game contributes no opponent and no orientation at all. This holds at
    // every flag setting: a contradiction is never evidence.
    const contradicted = !!(
      resolved && storedOpponent && normalizeTeamKey(resolved.opponent) !== storedOpponent
    );
    const trusted = contradicted ? null : resolved;
    games.push({
      season: Number(row.season),
      week: Number(row.week),
      points,
      weeksAgo: weeksAgo({ gameSeason: row.season, gameWeek: row.week, season, week }),
      sameSeason,
      opponent: trusted && (sameSeason || crossSeason) ? trusted.opponent : null,
      isHome: trusted && (sameSeason || useStoredHistory) ? trusted.isHome : null,
      hasRole: hasRoleSignal(row.stats),
      // Opportunity counts for the model's usage component. Read from the same
      // `stats` jsonb the history SELECT already returns, so this costs no
      // extra query and no extra column.
      usage: usageFromStats(row.stats),
    });
  }
  games.sort((a, b) => a.weeksAgo - b.weeksAgo);
  return games;
}

/**
 * Pure: league-wide positional context from one season-to-date scan.
 *
 * Returns, per position group:
 *  - `baselinePerGame`: the average a player of that group scores in a game
 *    (the last-resort shrinkage target),
 *  - `allowedByDefense`: what each defense has allowed per game,
 *  - `leagueAllowedPerGame`: the league-average allowance to compare against,
 *  - `homeAway`: the empirical home/away split,
 *  - `residuals`: pooled per-game deviations from each player's own mean,
 *    which is what gives a thin-sample player a usable interval,
 *  - `efficiencyPerOpportunity`: league-scored points per opportunity, the
 *    shrinkage target for the model's usage component.
 *
 * That last one is accumulated over the SAME scanned rows as everything else
 * (one pass, one cap) and only over rows whose opportunity count is actually
 * computable, so a group with no enrichment — or one that has no opportunity
 * denominator at all, like K or DEF — reports `null` rather than a ratio
 * assembled out of the rows that happened to have data.
 */
function buildLeagueContext({ rows, rules, defenseGamesByTeam }) {
  const byGroup = new Map();
  const playerTotals = new Map(); // playerId -> { group, points: [] }

  const groupBucket = (group) => {
    if (!byGroup.has(group)) {
      byGroup.set(group, {
        totalPoints: 0,
        totalGames: 0,
        allowed: new Map(), // defense -> points allowed
        homePoints: 0,
        homeGames: 0,
        awayPoints: 0,
        awayGames: 0,
        residuals: [],
        opportunityPoints: 0,
        opportunities: 0,
        opportunityGames: 0,
      });
    }
    return byGroup.get(group);
  };

  for (const row of rows || []) {
    const group = model.positionGroup(row.position);
    if (!group) continue;
    const points = calculateFantasyPoints(row.stats, rules);
    const bucket = groupBucket(group);
    bucket.totalPoints += points;
    bucket.totalGames += 1;
    if (row.defense) {
      bucket.allowed.set(row.defense, (bucket.allowed.get(row.defense) || 0) + points);
    }
    // Orientation only. A neutral-site row is excluded from BOTH sides rather
    // than assigned to the nominal home team's: the whole sample exists to
    // measure what playing at home is worth, and a London game contributes
    // nothing to that question in either direction. It still counts toward the
    // position baseline, the defense's allowance, the residual pool and the
    // efficiency rate above, all of which are indifferent to where it was
    // played.
    const orientation = scheduleOrientation(row);
    if (orientation === true) {
      bucket.homePoints += points;
      bucket.homeGames += 1;
    } else if (orientation === false) {
      bucket.awayPoints += points;
      bucket.awayGames += 1;
    }
    // Only rows whose opportunity count is knowable feed the efficiency rate,
    // and both sides of the ratio come from the SAME rows: mixing a group's
    // full point total with the opportunities of the subset that carried usage
    // keys would inflate the rate by exactly the coverage gap.
    const opportunities = model.opportunitiesForGame(usageFromStats(row.stats), group);
    if (opportunities !== null) {
      bucket.opportunityPoints += points;
      bucket.opportunities += opportunities;
      bucket.opportunityGames += 1;
    }
    if (!playerTotals.has(row.player_id)) playerTotals.set(row.player_id, { group, points: [] });
    playerTotals.get(row.player_id).points.push(points);
  }

  // Pooled residuals: each game's deviation from that player's own mean. Only
  // players with 2+ games contribute, since a single game has no deviation.
  for (const { group, points } of playerTotals.values()) {
    if (points.length < 2) continue;
    const mean = points.reduce((s, p) => s + p, 0) / points.length;
    const bucket = groupBucket(group);
    for (const p of points) bucket.residuals.push(p - mean);
  }

  const context = new Map();
  for (const [group, bucket] of byGroup) {
    const allowedByDefense = new Map();
    let allowedSum = 0;
    let defenseGameSum = 0;
    for (const [defense, points] of bucket.allowed) {
      const games = defenseGamesByTeam.get(defense) || 0;
      if (games <= 0) continue;
      allowedByDefense.set(defense, { allowedPerGame: points / games, games });
      allowedSum += points;
      defenseGameSum += games;
    }
    context.set(group, {
      baselinePerGame: bucket.totalGames > 0 ? bucket.totalPoints / bucket.totalGames : null,
      playerGames: bucket.totalGames,
      allowedByDefense,
      leagueAllowedPerGame: defenseGameSum > 0 ? allowedSum / defenseGameSum : null,
      homeAway: {
        homeMean: bucket.homeGames > 0 ? bucket.homePoints / bucket.homeGames : null,
        homeGames: bucket.homeGames,
        awayMean: bucket.awayGames > 0 ? bucket.awayPoints / bucket.awayGames : null,
        awayGames: bucket.awayGames,
      },
      residuals: bucket.residuals,
      efficiencyPerOpportunity: bucket.opportunities > 0
        ? bucket.opportunityPoints / bucket.opportunities
        : null,
      opportunityGames: bucket.opportunityGames,
    });
  }
  return context;
}

/**
 * Pure: prior meetings between this player and the target opponent, each paired
 * with the player's baseline EXCLUDING those meetings — so the factor measures
 * "better than his usual against them", not "he was good that year".
 *
 * Restricted to the current season by default: for a row the nflverse backfill
 * never touched, `player_stats` carries no per-week team, so a prior-season
 * row's opponent would be derived from the player's CURRENT team's old
 * schedule. That mapping is uncertain, and an uncertain mapping produces no
 * factor.
 *
 * `versusOpponent.crossSeason` (false today) widens that to every game whose
 * opponent buildPriorGames could actually RESOLVE, in any season of the
 * history window. The pool then changes on both sides at once: an earlier
 * meeting can count, and the exclusion baseline it is measured against becomes
 * the player's other opponent-known games rather than his other current-season
 * games. Each record still carries `seasonsAgo`, which is what
 * model.versusOpponentEffect decays by `halfLifeSeasons`. Without it an old
 * meeting would count as heavily as last month's.
 */
function buildVersusOpponentMeetings({ priorGames, opponent, season, constants = model.MODEL_CONSTANTS }) {
  if (!opponent) return [];
  const crossSeason = !!(constants && constants.versusOpponent && constants.versusOpponent.crossSeason);
  const eligible = (priorGames || []).filter((g) => (crossSeason
    ? g.opponent != null
    : g.season === Number(season)));
  const meetings = eligible.filter((g) => g.opponent === opponent);
  if (meetings.length === 0) return [];
  const others = eligible.filter((g) => g.opponent !== opponent);
  const baseline = others.length > 0
    ? others.reduce((s, g) => s + g.points, 0) / others.length
    : null;
  if (!isNum(baseline) || Number(baseline) <= 0) return [];
  return meetings.map((g) => ({
    points: g.points,
    baseline,
    seasonsAgo: Number(season) - g.season,
  }));
}

// ---------------------------------------------------------------------------
// DB layer
// ---------------------------------------------------------------------------

/**
 * Every input the model needs for one (season, week, league, player set),
 * loaded in a fixed number of batched queries regardless of roster size.
 *
 * `client` defaults to the pool but accepts a transaction client so a caller
 * already inside one does not deadlock against itself.
 */
async function loadFeatureBundle({ season, week, playerIds, rules, client = pool, positions = null }) {
  const ids = [...new Set((playerIds || []).map(Number).filter(Number.isInteger))];
  if (ids.length === 0) {
    return {
      players: new Map(),
      priorStatsByPlayer: new Map(),
      seasonRowsByPlayer: new Map(),
      targetGames: new Map(),
      leagueContext: new Map(),
      byeByTeam: new Map(),
      opponentByTeamWeek: new Map(),
      defenseGamesByTeam: new Map(),
      sourceCoverage: emptyCoverage(),
      inputCutoff: null,
    };
  }

  const firstSeason = Number(season) - HISTORY_SEASONS;

  const [playersResult, statsResult, seasonResult, targetScheduleResult, priorScheduleResult] =
    await Promise.all([
      client.query(
        // team_key is the schedule-joinable spelling of nfl_team: DEF units
        // store a full team name and Tank01/nflverse disagree on WSH vs WAS,
        // so every team comparison in this file goes through it.
        `SELECT "id", "name", "position", "nfl_team", "injury_status", "injury_detail", "adp",
                fn_normalize_nfl_team("nfl_team") AS "team_key"
         FROM "players" WHERE "id" = ANY($1::int[])`,
        [ids]
      ),
      // The input cutoff, in SQL: strictly earlier seasons, or this season
      // strictly before the target week. Week W itself can never be selected.
      client.query(
        `SELECT "player_id", "season", "week", "stats"
         FROM "player_stats"
         WHERE "player_id" = ANY($1::int[])
           AND "season" >= $2
           AND ("season" < $3 OR ("season" = $3 AND "week" < $4))
         ORDER BY "season" DESC, "week" DESC`,
        [ids, firstSeason, season, week]
      ),
      client.query(
        `SELECT "player_id", "season", "games_played", "stats", "fantasy_points"
         FROM "player_season_stats"
         WHERE "player_id" = ANY($1::int[]) AND "season" < $2`,
        [ids, season]
      ),
      client.query(
        `SELECT fn_normalize_nfl_team("nfl_team") AS "team_key",
                fn_normalize_nfl_team("opponent") AS "opponent_key",
                "nfl_team", "opponent", "kickoff_at", "game_key", "home_away",
                "neutral_site", "venue", "roof", "surface", "latitude", "longitude", "rest_days"
         FROM "nfl_games" WHERE "season" = $1 AND "week" = $2`,
        [season, week]
      ),
      // Schedule orientation for every COMPLETED week in the history window,
      // not just this season's: a prior-season stat row that carries a stored
      // per-week team can only be tied to a game if that game is loaded. The
      // input cutoff is spelled exactly as the stats query above spells it, so
      // widening the window still cannot reach week W or anything after it.
      client.query(
        `SELECT "season", "week", fn_normalize_nfl_team("nfl_team") AS "team_key",
                fn_normalize_nfl_team("opponent") AS "opponent_key", "home_away", "neutral_site"
         FROM "nfl_games"
         WHERE "season" >= $1
           AND ("season" < $2 OR ("season" = $2 AND "week" < $3))`,
        [firstSeason, season, week]
      ),
    ]);

  assertNoFutureRows(statsResult.rows, { season, week });

  const players = new Map(playersResult.rows.map((r) => [r.id, r]));
  const priorStatsByPlayer = new Map();
  for (const row of statsResult.rows) {
    if (!priorStatsByPlayer.has(row.player_id)) priorStatsByPlayer.set(row.player_id, []);
    priorStatsByPlayer.get(row.player_id).push(row);
  }
  const seasonRowsByPlayer = new Map();
  for (const row of seasonResult.rows) {
    if (!seasonRowsByPlayer.has(row.player_id)) seasonRowsByPlayer.set(row.player_id, []);
    seasonRowsByPlayer.get(row.player_id).push(row);
  }

  const targetGames = new Map();
  for (const row of targetScheduleResult.rows) targetGames.set(row.team_key, row);

  // Schedule orientation for every completed week, keyed by season+week+team so
  // a player's historical rows can be tied to who he faced and where. The
  // season belongs in the key now that earlier seasons are loaded: without it a
  // 2024 Week 3 game and a 2025 Week 3 game would overwrite each other.
  //
  // WHO he faced survives a neutral site; WHERE does not, which is why only
  // `isHome` goes through scheduleOrientation. This map is read only behind
  // `homeAway.useStoredHistory`, so today nothing consumes the orientation at
  // all — it is correct here so that turning that gate on is a decision about
  // prior-season history and not an accidental claim that Munich was a home
  // game for somebody.
  const opponentByTeamWeek = new Map();
  for (const row of priorScheduleResult.rows) {
    opponentByTeamWeek.set(`${row.season}:${row.week}:${row.team_key}`, {
      opponent: row.opponent_key,
      isHome: scheduleOrientation(row),
    });
  }

  // League-wide scan for the positions actually requested. `fn_normalize_nfl_team`
  // on both sides is what lets DEF units (stored with a full team name) join
  // the schedule at all, and collapses the WSH/WAS alias split.
  //
  // The ORDER BY is a CORRECTNESS requirement, not a nicety. Postgres gives no
  // row order without one, so an unordered `LIMIT` both picks an arbitrary
  // SUBSET when it truncates and returns an arbitrary PERMUTATION when it does
  // not. That order flows straight into `bucket.residuals` below, and
  // `simulateDistribution` samples residuals BY INDEX: a plan change, a
  // vacuum, or a parallel seq-scan could therefore hand two identical database
  // states two different medians. Ordering by (player_id, week) also makes the
  // truncation case whole-player-prefix rather than a random spray.
  // `simulateDistribution` canonically sorts its pool as a second, independent
  // defense; neither one alone is relied upon.
  const scanPositions = positions && positions.length > 0
    ? positions
    : [...new Set(playersResult.rows.map((r) => r.position).filter(Boolean))];
  let leagueRows = [];
  if (scanPositions.length > 0 && Number(week) > 1) {
    const scan = await client.query(
      `SELECT "ps"."player_id", "ps"."week", "ps"."stats", "p"."position",
              fn_normalize_nfl_team("ng"."opponent") AS "defense",
              "ng"."home_away", "ng"."neutral_site"
       FROM "player_stats" "ps"
       JOIN "players" "p" ON "p"."id" = "ps"."player_id"
       LEFT JOIN "nfl_games" "ng" ON "ng"."season" = "ps"."season" AND "ng"."week" = "ps"."week"
         AND fn_normalize_nfl_team("ng"."nfl_team") = fn_normalize_nfl_team("p"."nfl_team")
       WHERE "ps"."season" = $1 AND "ps"."week" < $2 AND "p"."position" = ANY($3::text[])
       ORDER BY "ps"."player_id", "ps"."week"
       LIMIT $4`,
      [season, week, scanPositions, MAX_LEAGUE_SCAN_ROWS]
    );
    leagueRows = scan.rows;
  }

  // Defense games must be keyed the same way the scan's `defense` column is.
  // Gated on the TARGET season's completed weeks specifically: the count below
  // is a season-to-date count, so prior-season rows in the widened schedule
  // read above must not be what decides to go and fetch it.
  const currentSeasonScheduleRows = priorScheduleResult.rows
    .filter((r) => Number(r.season) === Number(season));
  const normalizedDefenseGames = new Map();
  if (currentSeasonScheduleRows.length > 0) {
    const normalized = await client.query(
      `SELECT fn_normalize_nfl_team("nfl_team") AS "team", COUNT(*)::int AS "games"
       FROM "nfl_games" WHERE "season" = $1 AND "week" < $2
       GROUP BY 1`,
      [season, week]
    );
    for (const row of normalized.rows) normalizedDefenseGames.set(row.team, Number(row.games));
  }

  const leagueContext = buildLeagueContext({
    rows: leagueRows,
    rules,
    defenseGamesByTeam: normalizedDefenseGames,
  });

  const byeByTeam = await computeByeWeeks(
    playersResult.rows.map((r) => r.nfl_team),
    season,
    // The bundle's client, not the global pool: a transactional caller (the
    // holdout capture) must see byes from the same snapshot as everything
    // else in this bundle.
    { client }
  );

  // The run-level cutoff is the EARLIEST kickoff in the week: past it, some
  // information about week W exists in the world, so a run generated after it
  // can no longer claim a clean pre-kickoff feature set for every player.
  const kickoffs = targetScheduleResult.rows
    .map((r) => (r.kickoff_at ? new Date(r.kickoff_at).getTime() : null))
    .filter((t) => Number.isFinite(t));
  const inputCutoff = kickoffs.length > 0 ? new Date(Math.min(...kickoffs)) : null;

  return {
    players,
    priorStatsByPlayer,
    seasonRowsByPlayer,
    targetGames,
    leagueContext,
    byeByTeam,
    opponentByTeamWeek,
    defenseGamesByTeam: normalizedDefenseGames,
    leagueScanRows: leagueRows.length,
    scanTruncated: leagueRows.length >= MAX_LEAGUE_SCAN_ROWS,
    inputCutoff,
    sourceCoverage: null, // filled in by the engine, which knows about weather/expert too
  };
}

function emptyCoverage() {
  return {
    playerStats: { status: 'unavailable' },
    priorSeason: { status: 'unavailable' },
    schedule: { status: 'unavailable' },
    opponent: { status: 'unavailable' },
    homeAway: { status: 'unavailable' },
    injury: { status: 'unavailable' },
  };
}

module.exports = {
  HISTORY_SEASONS,
  MAX_LEAGUE_SCAN_ROWS,
  ROLE_KEYS,
  hasRoleSignal,
  normalizeTeamKey,
  scheduleOrientation,
  usageFromStats,
  weeksAgo,
  assertNoFutureRows,
  buildPriorGames,
  buildLeagueContext,
  buildVersusOpponentMeetings,
  loadFeatureBundle,
  emptyCoverage,
};
