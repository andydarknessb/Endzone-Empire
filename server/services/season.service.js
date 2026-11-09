const pool = require('../modules/pool');
const { withTransaction } = require('../modules/withTransaction');
const { leagueWrite } = require('../modules/leagueWrite');
const { seasonOperationsAvailable, SEASON_BEFORE_DRAFT_MESSAGE } = require('./leaguePhase');
const { round2 } = require('./scoringRules');

class SeasonError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

/**
 * Pure: circle-method round-robin pairings for one week (1-indexed).
 * Odd team counts get a ghost slot — the team paired with it has a bye and
 * is omitted. Home/away flips on alternate cycles through the rotation.
 * Returns [{ home, away }].
 */
function roundRobinPairings(teamIds, week) {
  const ids = [...teamIds];
  if (ids.length < 2) return [];
  if (ids.length % 2 === 1) ids.push(null); // ghost = bye
  const n = ids.length;
  const roundsPerCycle = n - 1;
  const round = (week - 1) % roundsPerCycle;
  const cycle = Math.floor((week - 1) / roundsPerCycle);

  const fixed = ids[0];
  const rest = ids.slice(1);
  const rotated = rest.slice(round).concat(rest.slice(0, round));
  const order = [fixed, ...rotated];

  const pairings = [];
  for (let i = 0; i < n / 2; i++) {
    let home = order[i];
    let away = order[n - 1 - i];
    if (home === null || away === null) continue; // bye
    if (cycle % 2 === 1) [home, away] = [away, home]; // alternate venues by cycle
    pairings.push({ home, away });
  }
  return pairings;
}

/**
 * Pure: standings from finished regular-season matchups.
 * teams: [{ id, name }], matchups: rows with home_team_id/away_team_id,
 * home_score/away_score, week, final, is_playoff.
 * Ordering: record -> head-to-head (within the tied group) -> points-for.
 * Returns [{ teamId, name, wins, losses, ties, pf, pa, streak, rank, winPct }].
 */
function computeStandings(teams, matchups) {
  const rows = new Map(
    teams.map((t) => [t.id, {
      teamId: t.id,
      name: t.name,
      wins: 0, losses: 0, ties: 0,
      pf: 0, pa: 0,
      results: [], // [{ week, result: 'W'|'L'|'T' }]
    }])
  );
  const counted = matchups
    .filter((m) => m.final && !m.is_playoff)
    .sort((a, b) => a.week - b.week);

  for (const m of counted) {
    const home = rows.get(m.home_team_id);
    const away = rows.get(m.away_team_id);
    if (!home || !away) continue;
    const hs = Number(m.home_score);
    const as = Number(m.away_score);
    home.pf += hs; home.pa += as;
    away.pf += as; away.pa += hs;
    let homeResult = 'T';
    if (hs > as) homeResult = 'W';
    else if (hs < as) homeResult = 'L';
    const awayResult = homeResult === 'W' ? 'L' : homeResult === 'L' ? 'W' : 'T';
    home[homeResult === 'W' ? 'wins' : homeResult === 'L' ? 'losses' : 'ties'] += 1;
    away[awayResult === 'W' ? 'wins' : awayResult === 'L' ? 'losses' : 'ties'] += 1;
    home.results.push({ week: m.week, result: homeResult });
    away.results.push({ week: m.week, result: awayResult });
  }

  const standings = Array.from(rows.values()).map((r) => {
    const games = r.wins + r.losses + r.ties;
    const winPct = games === 0 ? 0 : (r.wins + r.ties / 2) / games;
    // Trailing streak, e.g. W3 / L1 / T2
    let streak = '-';
    if (r.results.length > 0) {
      const last = r.results[r.results.length - 1].result;
      let n = 0;
      for (let i = r.results.length - 1; i >= 0 && r.results[i].result === last; i--) n += 1;
      streak = `${last}${n}`;
    }
    const { results, ...rest } = r;
    return { ...rest, winPct, streak, pf: round2(r.pf), pa: round2(r.pa) };
  });

  // Head-to-head win pct within a record-tied group
  const h2hPct = (teamId, groupIds) => {
    let wins = 0; let games = 0;
    for (const m of counted) {
      const involvesBoth =
        (m.home_team_id === teamId && groupIds.has(m.away_team_id)) ||
        (m.away_team_id === teamId && groupIds.has(m.home_team_id));
      if (!involvesBoth) continue;
      games += 1;
      const hs = Number(m.home_score);
      const as = Number(m.away_score);
      if (hs === as) wins += 0.5;
      else if ((m.home_team_id === teamId) === (hs > as)) wins += 1;
    }
    return games === 0 ? 0 : wins / games;
  };

  standings.sort((a, b) => b.winPct - a.winPct);
  const ordered = [];
  let i = 0;
  while (i < standings.length) {
    let j = i;
    while (j < standings.length && standings[j].winPct === standings[i].winPct) j += 1;
    const group = standings.slice(i, j);
    if (group.length > 1) {
      const groupIds = new Set(group.map((g) => g.teamId));
      group.sort(
        (a, b) =>
          h2hPct(b.teamId, groupIds) - h2hPct(a.teamId, groupIds) ||
          b.pf - a.pf ||
          a.teamId - b.teamId
      );
    }
    ordered.push(...group);
    i = j;
  }
  return ordered.map((row, index) => ({ ...row, rank: index + 1 }));
}

/**
 * Pure: the Waiver priority order a standings table implies. Waiver priority
 * is reverse standings (CONTEXT.md): the last-place team claims first, so
 * the team ranked N of N gets priority 1 and the leader gets priority N.
 * `standings` is computeStandings' output, already ranked best first with
 * every tie broken, so this is a straight reversal and never a re-sort.
 * Returns [{ teamId, priority }].
 */
function waiverPrioritiesFromStandings(standings) {
  const count = standings.length;
  return standings.map((s) => ({ teamId: s.teamId, priority: count - s.rank + 1 }));
}

/**
 * Reset every team's waiver_priority to reverse standings, in one statement.
 * Runs inside the caller's transaction, under the league row's FOR NO KEY UPDATE
 * lock. The one time-based writer of waiver_priority: the other writer is
 * processWaivers (waiver.service.js), which sends a claim winner to the back
 * of the order; that rotation lasts only until the next reset here.
 */
async function resetWaiverPriorities(client, { leagueId, standings }) {
  const order = waiverPrioritiesFromStandings(standings);
  if (order.length === 0) return;
  await client.query(
    `UPDATE "teams" SET "waiver_priority" = "order"."priority", "updated_at" = now()
     FROM unnest($2::int[], $3::int[]) AS "order"("team_id", "priority")
     WHERE "teams"."league_id" = $1 AND "teams"."id" = "order"."team_id"`,
    [leagueId, order.map((o) => o.teamId), order.map((o) => o.priority)]
  );
}

/**
 * Pure: pair playoff qualifiers for a round, best remaining seed vs. worst
 * (re-seeded every round). Top seeds get byes until the field is a power of
 * two — e.g. 6 teams: seeds 1-2 bye, 3v6, 4v5.
 * entrants: [{ teamId, seed }]. Returns { games: [{home, away}], byes: [teamId] }.
 */
function pairBySeed(entrants) {
  const sorted = [...entrants].sort((a, b) => a.seed - b.seed);
  const n = sorted.length;
  if (n < 2) return { games: [], byes: sorted.map((e) => e.teamId) };
  const nextPow2 = 2 ** Math.ceil(Math.log2(n));
  const byeCount = nextPow2 - n; // byes + winners = next power of two
  const playing = n - byeCount;
  const byes = sorted.slice(0, byeCount).map((e) => e.teamId);
  const field = sorted.slice(byeCount);
  const games = [];
  for (let i = 0; i < playing / 2; i++) {
    games.push({ home: field[i].teamId, away: field[field.length - 1 - i].teamId });
  }
  return { games, byes };
}

/**
 * Pure: split final regular-season standings into the opening championship
 * and consolation brackets. Each bracket is seeded independently, preserving
 * standings order while allowing pairBySeed to assign any required byes.
 */
function buildOpeningBrackets({ standings, playoffTeams, consolationEnabled }) {
  const playoffCount = Math.min(Math.max(Number(playoffTeams) || 0, 0), standings.length);
  const seed = (rows) => rows.map((row, index) => ({ teamId: row.teamId, seed: index + 1 }));
  const emptyBracket = { games: [], byes: [] };

  return {
    playoff: pairBySeed(seed(standings.slice(0, playoffCount))),
    consolation: consolationEnabled
      ? pairBySeed(seed(standings.slice(playoffCount)))
      : emptyBracket,
  };
}

/**
 * Pure: the number of playoff rounds needed to reduce `playoffTeams` entrants
 * to one champion — the same halving `pairBySeed` performs bracket round by
 * bracket round, and Advance week plays out one round per week:
 * `ceil(log2(n))`. Fewer than two entrants means no bracket is ever played.
 */
function playoffRounds(playoffTeams) {
  const n = Math.max(0, Number(playoffTeams) || 0);
  return n < 2 ? 0 : Math.ceil(Math.log2(n));
}

/**
 * Pure: the last week of `league`'s season a fantasy matchup can still be
 * played — its last playoff week, `regular_season_weeks` plus the rounds
 * `playoffRounds` derives from `playoff_teams`. A league with fewer than two
 * playoff teams ends at its last regular-season week.
 */
function lastPlayoffWeek(league) {
  const regularWeeks = Number(league && league.regular_season_weeks) || 0;
  return regularWeeks + playoffRounds(league && league.playoff_teams);
}

/**
 * The schedule work itself, on a caller-supplied client. Owns no transaction:
 * the exported generateRegularSeason decides which client this runs on and who
 * BEGINs/COMMITs around it. `forUpdate` selects the league read text - the two
 * texts that existed before #1073, unchanged: WITH `FOR NO KEY UPDATE` when this owns
 * the transaction (nothing else holds the row), WITHOUT it when nested inside a
 * caller's transaction that already wrote and holds the league row.
 */
async function generateRegularSeasonInner(client, { leagueId }) {
  const leagueResult = await client.query(`SELECT * FROM "leagues" WHERE "id" = $1`, [leagueId]);
  const league = leagueResult.rows[0];
  if (!league) throw new SeasonError(404, 'league not found');
  // #194: season operations refuse a league still pre-draft or drafting (league
  // phase, not a bare draft_status read). The draft-time caller is
  // draftCompletion.completeDraft, which runs after the status flip.
  if (!seasonOperationsAvailable(league)) throw new SeasonError(409, SEASON_BEFORE_DRAFT_MESSAGE);
  const teamsResult = await client.query(
    `SELECT "id" FROM "teams" WHERE "league_id" = $1 ORDER BY "draft_position" NULLS LAST, "id"`,
    [leagueId]
  );
  const teamIds = teamsResult.rows.map((r) => r.id);
  if (teamIds.length < 2) throw new SeasonError(409, 'need at least 2 teams to schedule a season');

  let created = 0;
  for (let week = 1; week <= league.regular_season_weeks; week++) {
    const existing = await client.query(
      `SELECT 1 FROM "matchups" WHERE "league_id" = $1 AND "season" = $2 AND "week" = $3 LIMIT 1`,
      [leagueId, league.current_season, week]
    );
    if (existing.rows[0]) continue;
    for (const pairing of roundRobinPairings(teamIds, week)) {
      await client.query(
        `INSERT INTO "matchups" ("league_id", "season", "week", "home_team_id", "away_team_id")
         VALUES ($1, $2, $3, $4, $5)`,
        [leagueId, league.current_season, week, pairing.home, pairing.away]
      );
      created += 1;
    }
  }
  return { created, weeks: league.regular_season_weeks };
}

/**
 * Generate the full regular-season schedule for a league (idempotent per
 * week: weeks that already have matchups are skipped). Runs in its own
 * transaction unless a client is supplied.
 *
 * With no client it owns the transaction through leagueWrite (ADR 0070), which
 * takes the League row lock. draftCompletion passes its own draft-completion
 * client; the inner then runs on that client directly and takes no League lock,
 * because the caller's transaction already holds the row. The exported signature
 * is unchanged.
 */
async function generateRegularSeason({ leagueId }, existingClient = null) {
  if (existingClient) {
    return generateRegularSeasonInner(existingClient, { leagueId });
  }
  return leagueWrite(
    { leagueId, label: 'generateRegularSeason' },
    ({ client }) => generateRegularSeasonInner(client, { leagueId })
  );
}

/** Standings for a league straight from the database. */
async function getStandings({ leagueId }) {
  const teamsResult = await pool.query(
    `SELECT "teams"."id", "teams"."name", "teams"."avatar_url", "teams"."avatar_static_url"
     FROM "teams"
     WHERE "league_id" = $1`,
    [leagueId]
  );
  if (teamsResult.rows.length === 0) throw new SeasonError(404, 'league has no teams');
  const matchupsResult = await pool.query(
    `SELECT "matchups".*
     FROM "matchups"
     JOIN "leagues" ON "leagues"."id" = "matchups"."league_id"
     WHERE "matchups"."league_id" = $1
       AND "matchups"."season" = "leagues"."current_season"`,
    [leagueId]
  );
  const standings = computeStandings(teamsResult.rows, matchupsResult.rows);
  // Kept out of computeStandings itself (a pure function also used to build
  // the frozen league_history snapshot on rollover) so avatars never get
  // baked into that historical record — overlaid here instead. Avatars only:
  // Team identity (CONTEXT.md) forbids a manager's account username on a
  // standings row (#373), and the Team name already on the row from
  // computeStandings is the display identity.
  const teamMeta = new Map(
    teamsResult.rows.map((t) => [t.id, { avatarUrl: t.avatar_url, avatarStaticUrl: t.avatar_static_url }])
  );
  return standings.map((s) => ({ ...s, ...teamMeta.get(s.teamId) }));
}

/**
 * The current season's stored Playoff seeds as Map(teamId -> seed). Empty
 * until the bracket is created (and for a League already in its playoffs
 * before seeds were stored).
 */
async function getPlayoffSeeds({ leagueId }) {
  const result = await pool.query(
    `SELECT "playoff_seeds"."team_id", "playoff_seeds"."seed"
     FROM "playoff_seeds"
     JOIN "leagues" ON "leagues"."id" = "playoff_seeds"."league_id"
     WHERE "playoff_seeds"."league_id" = $1
       AND "playoff_seeds"."season" = "leagues"."current_season"`,
    [leagueId]
  );
  return new Map(result.rows.map((r) => [r.team_id, r.seed]));
}

/**
 * Give every team in a matchup of the week that just opened its lineup rows
 * now, rather than at the first score sync or the first lineup view. Until
 * this ran, a team nobody had touched had no starters to sum, so its Game
 * Center card showed a dash where every other card showed an expected
 * final. Best-effort and after the advance has committed: a seed problem
 * on one roster, or no connection to spare, must not undo a week advance
 * or turn it into an error, so everything here, the connection included,
 * runs inside the guard, in its own transaction, and logs rather than
 * throws. A week with no matchups (a season that just completed) has
 * nothing to do. Required lazily: lineup.service is loaded by paths that
 * also load this module.
 */
async function materializeNewWeekLineups({ leagueId, season, week, league }) {
  try {
    const { materializeLineup } = require('./lineup.service');
    // The team read runs on the pool, outside the transaction, so the
    // zero-teams return happens before any wrapper call (there is nothing to
    // materialize, and nothing to open a transaction for).
    const nextMatchups = await pool.query(
      `SELECT "home_team_id", "away_team_id" FROM "matchups"
       WHERE "league_id" = $1 AND "season" = $2 AND "week" = $3`,
      [leagueId, season, week]
    );
    const teamIds = [...new Set(nextMatchups.rows.flatMap((m) => [m.home_team_id, m.away_team_id]))];
    if (teamIds.length === 0) return;
    await withTransaction(
      pool,
      async (client) => {
        for (const teamId of teamIds) {
          await materializeLineup(client, { leagueId, teamId, season, week, league });
        }
      },
      { label: 'materializeNewWeekLineups' }
    );
  } catch (error) {
    // Everything here - the team read, the connection and the transaction alike
    // - is best-effort (ADR 0033, #1072): a seed problem on one roster or no
    // connection to spare must never undo or error a committed week advance, so
    // the whole thing stays inside this swallow-and-log, the wrapper owning the
    // close (a rejecting rollback destroys the connection instead of escaping).
    console.error('new-week lineups not materialized', { leagueId, week, error: error.message });
  }
}

module.exports = {
  SeasonError,
  roundRobinPairings,
  computeStandings,
  waiverPrioritiesFromStandings,
  resetWaiverPriorities,
  pairBySeed,
  buildOpeningBrackets,
  generateRegularSeason,
  getStandings,
  getPlayoffSeeds,
  materializeNewWeekLineups,
  playoffRounds,
  lastPlayoffWeek,
};
