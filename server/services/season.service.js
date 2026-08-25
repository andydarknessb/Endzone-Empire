const pool = require('../modules/pool');
const { notifyLeague } = require('./activity.service');
const { seasonOperationsAvailable, SEASON_BEFORE_DRAFT_MESSAGE } = require('./leaguePhase');

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

function round2(x) {
  return Math.round(x * 100) / 100;
}

/**
 * Generate the full regular-season schedule for a league (idempotent per
 * week: weeks that already have matchups are skipped). Runs in its own
 * transaction unless a client is supplied.
 */
async function generateRegularSeason({ leagueId }, existingClient = null) {
  const client = existingClient || (await pool.connect());
  try {
    if (!existingClient) await client.query('BEGIN');
    const leagueResult = await client.query(
      `SELECT * FROM "leagues" WHERE "id" = $1${existingClient ? '' : ' FOR UPDATE'}`,
      [leagueId]
    );
    const league = leagueResult.rows[0];
    if (!league) throw new SeasonError(404, 'league not found');
    // #194: season operations are unavailable before the draft finishes.
    // Derived from league phase, never a bare draft_status comparison.
    // NOTE: this reads the row the CALLER'S client just saw, which is what
    // lets draft completion through. Both completion paths (the final live
    // pick in draft.service, and a draft start with no live picks in
    // draftStart.service) set draft_status = 'complete' on their own
    // transaction BEFORE calling in here, so this sees 'complete'. That
    // ordering is load-bearing: move the generateRegularSeason call above
    // the UPDATE on either path and every finished draft starts failing.
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
    if (!existingClient) await client.query('COMMIT');
    return { created, weeks: league.regular_season_weeks };
  } catch (error) {
    if (!existingClient) await client.query('ROLLBACK');
    throw error;
  } finally {
    if (!existingClient) client.release();
  }
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
 * Close out the league's current week and advance: mark the week's matchups
 * final, then either schedule the next playoff round (regular season over),
 * advance the bracket, or crown a champion. Scores must already be computed
 * (scoring.service) before calling this. Transactional; commissioner- or
 * scheduler-driven.
 */
async function finalizeWeekAndAdvance({ leagueId }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const leagueResult = await client.query(
      `SELECT * FROM "leagues" WHERE "id" = $1 FOR UPDATE`,
      [leagueId]
    );
    const league = leagueResult.rows[0];
    if (!league) throw new SeasonError(404, 'league not found');
    // Phase first, before anything is marked final or advanced (#194).
    if (!seasonOperationsAvailable(league)) throw new SeasonError(409, SEASON_BEFORE_DRAFT_MESSAGE);
    if (league.season_status === 'complete') throw new SeasonError(409, 'season is complete');
    const { current_season: season, current_week: week } = league;

    const weekMatchups = await client.query(
      `SELECT * FROM "matchups" WHERE "league_id" = $1 AND "season" = $2 AND "week" = $3`,
      [leagueId, season, week]
    );
    if (weekMatchups.rows.length === 0) {
      throw new SeasonError(409, `no matchups exist for week ${week}; generate the schedule first`);
    }
    await client.query(
      `UPDATE "matchups" SET "final" = true WHERE "league_id" = $1 AND "season" = $2 AND "week" = $3`,
      [leagueId, season, week]
    );

    const allMatchups = await client.query(
      `SELECT * FROM "matchups" WHERE "league_id" = $1 AND "season" = $2`,
      [leagueId, season]
    );
    const teamsResult = await client.query(
      `SELECT "id", "name", "owner_id" FROM "teams" WHERE "league_id" = $1`,
      [leagueId]
    );
    const teams = teamsResult.rows;
    const nextWeek = week + 1;
    let outcome = { advancedTo: nextWeek, seasonStatus: league.season_status };

    if (league.season_status === 'regular' && week >= league.regular_season_weeks) {
      // Seed the playoff bracket from final standings
      const standings = computeStandings(teams, allMatchups.rows);
      const brackets = buildOpeningBrackets({
        standings,
        playoffTeams: league.playoff_teams,
        consolationEnabled: league.playoff_consolation,
      });
      for (const game of brackets.playoff.games) {
        await client.query(
          `INSERT INTO "matchups" ("league_id", "season", "week", "home_team_id", "away_team_id",
                                   "is_playoff", "playoff_round")
           VALUES ($1, $2, $3, $4, $5, true, 1)`,
          [leagueId, season, nextWeek, game.home, game.away]
        );
      }
      if (league.playoff_consolation) {
        for (const game of brackets.consolation.games) {
          await client.query(
            `INSERT INTO "matchups" ("league_id", "season", "week", "home_team_id", "away_team_id",
                                     "is_playoff", "playoff_round", "is_consolation")
             VALUES ($1, $2, $3, $4, $5, true, 1, true)`,
            [leagueId, season, nextWeek, game.home, game.away]
          );
        }
      }
      await client.query(
        `UPDATE "leagues" SET "season_status" = 'playoffs', "current_week" = $1, "updated_at" = now()
         WHERE "id" = $2`,
        [nextWeek, leagueId]
      );
      await notifyLeague(client, {
        leagueId,
        type: 'season',
        message: 'The regular season is over. Playoffs start this week!',
      });
      outcome = { advancedTo: nextWeek, seasonStatus: 'playoffs', playoffRound: 1 };
    } else if (league.season_status === 'playoffs') {
      const thisRound = weekMatchups.rows.filter((m) => m.is_playoff && !m.is_consolation);
      const roundNumber = thisRound[0] ? thisRound[0].playoff_round : null;
      const winners = thisRound.map((m) =>
        Number(m.home_score) >= Number(m.away_score) ? m.home_team_id : m.away_team_id
      );
      // Byes: playoff teams that didn't play this round advance automatically
      const seededStandings = computeStandings(teams, allMatchups.rows);
      const seedOf = new Map(seededStandings.map((s, i) => [s.teamId, i + 1]));
      const playedIds = new Set(thisRound.flatMap((m) => [m.home_team_id, m.away_team_id]));
      const priorQualifiers = new Set(
        allMatchups.rows
          .filter((m) => m.is_playoff && !m.is_consolation)
          .flatMap((m) => [m.home_team_id, m.away_team_id])
      );
      const byeTeams = seededStandings
        .slice(0, league.playoff_teams)
        .map((s) => s.teamId)
        .filter((id) => !playedIds.has(id) && !eliminatedBefore(allMatchups.rows, id, week));
      const advancing = [...new Set([...winners, ...byeTeams])];

      if (advancing.length <= 1) {
        const champion = teams.find((t) => t.id === winners[0]);
        await client.query(
          `UPDATE "leagues" SET "season_status" = 'complete', "current_week" = $1, "updated_at" = now()
           WHERE "id" = $2`,
          [nextWeek, leagueId]
        );
        await notifyLeague(client, {
          leagueId,
          type: 'season',
          message: `${champion ? champion.name : 'A champion'} has won the league championship!`,
          data: { championTeamId: winners[0] },
        });
        outcome = { advancedTo: nextWeek, seasonStatus: 'complete', championTeamId: winners[0] };
      } else {
        const entrants = advancing.map((teamId) => ({ teamId, seed: seedOf.get(teamId) || 99 }));
        for (const game of pairBySeed(entrants).games) {
          await client.query(
            `INSERT INTO "matchups" ("league_id", "season", "week", "home_team_id", "away_team_id",
                                     "is_playoff", "playoff_round")
             VALUES ($1, $2, $3, $4, $5, true, $6)`,
            [leagueId, season, nextWeek, game.home, game.away, (roundNumber || 1) + 1]
          );
        }
        await client.query(
          `UPDATE "leagues" SET "current_week" = $1, "updated_at" = now() WHERE "id" = $2`,
          [nextWeek, leagueId]
        );
        outcome = { advancedTo: nextWeek, seasonStatus: 'playoffs', playoffRound: (roundNumber || 1) + 1 };
      }
      void priorQualifiers;
    } else {
      // Plain regular-season week: schedule already exists, just move forward
      await client.query(
        `UPDATE "leagues" SET "current_week" = $1, "updated_at" = now() WHERE "id" = $2`,
        [nextWeek, leagueId]
      );
    }

    await client.query('COMMIT');
    return outcome;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Did this team already lose a (non-consolation) playoff game before `week`? */
function eliminatedBefore(matchups, teamId, week) {
  return matchups.some((m) => {
    if (!m.is_playoff || m.is_consolation || !m.final || m.week >= week) return false;
    if (m.home_team_id !== teamId && m.away_team_id !== teamId) return false;
    const hs = Number(m.home_score);
    const as = Number(m.away_score);
    const won = m.home_team_id === teamId ? hs >= as : as > hs;
    return !won;
  });
}

module.exports = {
  SeasonError,
  roundRobinPairings,
  computeStandings,
  pairBySeed,
  buildOpeningBrackets,
  generateRegularSeason,
  getStandings,
  finalizeWeekAndAdvance,
};
