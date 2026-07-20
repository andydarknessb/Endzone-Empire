const pool = require('../modules/pool');
const { computeStandings, pairBySeed } = require('./season.service');
const { parseLineupSettings, optimalLineup } = require('./lineup.service');
const { getWeekProjections } = require('./projection.service');

/**
 * Monte Carlo playoff odds + power rankings.
 *
 * Each run samples every remaining regular-season matchup from a normal
 * distribution per team (mean/variance from actual weekly scores, blended
 * with roster projections), reuses the real standings math (computeStandings)
 * to seed the bracket, then plays out the playoffs with the real re-seeding
 * pairer (pairBySeed). Aggregating ~1000 runs gives playoff and title odds
 * that respect the league's actual tiebreakers and bracket shape.
 */

const DEFAULT_RUNS = 1000;
const DEFAULT_MEAN = 100; // pre-data prior for a fantasy team's weekly score
const DEFAULT_SIGMA = 25;

/** Pure, seedable PRNG (mulberry32) so simulations are reproducible in tests. */
function mulberry32(seed) {
  let state = seed >>> 0;
  return function rng() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pure: one normal sample via Box-Muller. Clamped at 0 (scores can't go negative). */
function normalSample(rng, mean, sigma) {
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(0, mean + sigma * z);
}

/** Pure: mean and (population) stddev of a numeric array. */
function meanAndStddev(values) {
  if (values.length === 0) return { mean: 0, stddev: 0 };
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return { mean, stddev: Math.sqrt(variance) };
}

/**
 * Pure: per-team score model from actual weekly scores + a roster projection.
 * With 3+ weeks of history the mean blends 60/40 history/projection and sigma
 * comes from history (floored so early-season certainty isn't overstated);
 * with less it leans on the projection (or league-average prior).
 */
function buildTeamModel(weeklyScores, projectedWeekly) {
  const { mean: histMean, stddev } = meanAndStddev(weeklyScores);
  const proj = Number.isFinite(projectedWeekly) && projectedWeekly > 0 ? projectedWeekly : null;
  if (weeklyScores.length >= 3) {
    const mean = proj != null ? 0.6 * histMean + 0.4 * proj : histMean;
    return { mean, sigma: Math.max(stddev, 8) };
  }
  const mean = proj != null ? proj : weeklyScores.length > 0 ? histMean : DEFAULT_MEAN;
  return { mean, sigma: Math.max(0.25 * mean, 8) || DEFAULT_SIGMA };
}

/**
 * Pure: play one full simulation run.
 * teams: [{ id, name }]; playedMatchups: final regular-season rows;
 * remainingMatchups: [{ home_team_id, away_team_id, week }] not yet played;
 * models: Map teamId -> { mean, sigma }. Returns { qualifiers: [teamId...],
 * champion: teamId | null } (qualifiers in seed order).
 */
function simulateOnce({ teams, playedMatchups, remainingMatchups, models, playoffTeams, rng }) {
  const model = (teamId) => models.get(teamId) || { mean: DEFAULT_MEAN, sigma: DEFAULT_SIGMA };
  const simulated = remainingMatchups.map((m, i) => {
    const home = model(m.home_team_id);
    const away = model(m.away_team_id);
    return {
      id: -1 - i, // synthetic, must not collide with real ids in computeStandings
      week: m.week,
      final: true,
      is_playoff: false,
      home_team_id: m.home_team_id,
      away_team_id: m.away_team_id,
      home_score: normalSample(rng, home.mean, home.sigma),
      away_score: normalSample(rng, away.mean, away.sigma),
    };
  });
  const standings = computeStandings(teams, [...playedMatchups, ...simulated]);
  const qualifiers = standings
    .slice(0, Math.min(playoffTeams, teams.length))
    .map((s) => s.teamId);

  // Play the bracket with re-seeding until one team stands
  let entrants = qualifiers.map((teamId, i) => ({ teamId, seed: i + 1 }));
  while (entrants.length > 1) {
    const { games, byes } = pairBySeed(entrants);
    const advancing = byes.map((teamId) => ({
      teamId,
      seed: entrants.find((e) => e.teamId === teamId).seed,
    }));
    for (const game of games) {
      const home = model(game.home);
      const away = model(game.away);
      const winner =
        normalSample(rng, home.mean, home.sigma) >= normalSample(rng, away.mean, away.sigma)
          ? game.home
          : game.away;
      advancing.push({ teamId: winner, seed: entrants.find((e) => e.teamId === winner).seed });
    }
    entrants = advancing;
  }
  return { qualifiers, champion: entrants[0] ? entrants[0].teamId : null };
}

/**
 * Pure: continue an in-progress playoff bracket. Round 1 uses the actual
 * pending pairings (fixedGames: [{ home, away }]); alive teams not in a
 * pending game hold byes. Later rounds re-seed via pairBySeed. Returns the
 * champion teamId (or null for no entrants).
 */
function simulateBracketFrom({ aliveEntrants, fixedGames, models, rng }) {
  const model = (teamId) => models.get(teamId) || { mean: DEFAULT_MEAN, sigma: DEFAULT_SIGMA };
  const seedOf = new Map(aliveEntrants.map((e) => [e.teamId, e.seed]));
  let entrants = [...aliveEntrants];
  let pending = fixedGames;
  while (entrants.length > 1) {
    const games =
      pending && pending.length > 0 ? pending : pairBySeed(entrants).games;
    const inGames = new Set(games.flatMap((g) => [g.home, g.away]));
    const advancing = entrants
      .filter((e) => !inGames.has(e.teamId))
      .map((e) => ({ teamId: e.teamId, seed: e.seed }));
    for (const game of games) {
      const home = model(game.home);
      const away = model(game.away);
      const winner =
        normalSample(rng, home.mean, home.sigma) >= normalSample(rng, away.mean, away.sigma)
          ? game.home
          : game.away;
      advancing.push({ teamId: winner, seed: seedOf.get(winner) ?? 99 });
    }
    entrants = advancing;
    pending = null; // only the first round is anchored to real pairings
  }
  return entrants[0] ? entrants[0].teamId : null;
}

/**
 * Pure: aggregate `runs` simulations into per-team odds.
 * Returns Map teamId -> { playoffOdds, titleOdds } with values in [0, 1].
 */
function runSimulation({
  teams,
  playedMatchups,
  remainingMatchups,
  models,
  playoffTeams,
  runs = DEFAULT_RUNS,
  seed = 1,
}) {
  const rng = mulberry32(seed);
  const playoffCounts = new Map(teams.map((t) => [t.id, 0]));
  const titleCounts = new Map(teams.map((t) => [t.id, 0]));
  for (let i = 0; i < runs; i++) {
    const { qualifiers, champion } = simulateOnce({
      teams,
      playedMatchups,
      remainingMatchups,
      models,
      playoffTeams,
      rng,
    });
    for (const teamId of qualifiers) {
      playoffCounts.set(teamId, (playoffCounts.get(teamId) || 0) + 1);
    }
    if (champion != null) titleCounts.set(champion, (titleCounts.get(champion) || 0) + 1);
  }
  const odds = new Map();
  for (const team of teams) {
    odds.set(team.id, {
      playoffOdds: Math.round(((playoffCounts.get(team.id) || 0) / runs) * 1000) / 1000,
      titleOdds: Math.round(((titleCounts.get(team.id) || 0) / runs) * 1000) / 1000,
    });
  }
  return odds;
}

/**
 * Pure: power score blending record, scoring strength, and simulated odds.
 * standings from computeStandings; models/odds as above. Returns ranked
 * [{ teamId, name, rank, score, winPct, avgScore, playoffOdds, titleOdds }].
 */
function powerRankings(standings, models, odds) {
  const means = standings.map((s) => (models.get(s.teamId) || { mean: DEFAULT_MEAN }).mean);
  const maxMean = Math.max(...means, 1);
  const rows = standings.map((s) => {
    const model = models.get(s.teamId) || { mean: DEFAULT_MEAN };
    const teamOdds = odds.get(s.teamId) || { playoffOdds: 0, titleOdds: 0 };
    const score =
      0.45 * s.winPct + 0.35 * (model.mean / maxMean) + 0.2 * teamOdds.playoffOdds;
    return {
      teamId: s.teamId,
      name: s.name,
      winPct: s.winPct,
      avgScore: Math.round(model.mean * 100) / 100,
      playoffOdds: teamOdds.playoffOdds,
      titleOdds: teamOdds.titleOdds,
      score: Math.round(score * 1000) / 1000,
    };
  });
  rows.sort((a, b) => b.score - a.score || b.winPct - a.winPct || a.teamId - b.teamId);
  return rows.map((row, i) => ({ ...row, rank: i + 1 }));
}

/**
 * Orchestrator: build models from the league's real data, run the simulation,
 * and store the result in league_analytics (type 'power_rankings') for the
 * current week. Runs automatically after weekly scoring; safe to re-run.
 */
async function computeLeagueOdds({ leagueId, runs = DEFAULT_RUNS, seed }) {
  const leagueResult = await pool.query(`SELECT * FROM "leagues" WHERE "id" = $1`, [leagueId]);
  const league = leagueResult.rows[0];
  if (!league || league.draft_status !== 'complete') return null;
  const { current_season: season, current_week: week } = league;

  const teamsResult = await pool.query(
    `SELECT "id", "name" FROM "teams" WHERE "league_id" = $1`,
    [leagueId]
  );
  const teams = teamsResult.rows;
  if (teams.length < 2) return null;

  const matchupsResult = await pool.query(
    `SELECT "week", "home_team_id", "away_team_id", "home_score", "away_score",
            "is_playoff", "is_consolation", "final"
     FROM "matchups" WHERE "league_id" = $1 AND "season" = $2`,
    [leagueId, season]
  );
  const played = matchupsResult.rows.filter((m) => m.final && !m.is_playoff);
  const remaining = matchupsResult.rows.filter((m) => !m.final && !m.is_playoff);

  // Per-team weekly score history from played matchups
  const history = new Map(teams.map((t) => [t.id, []]));
  for (const m of played) {
    if (history.has(m.home_team_id)) history.get(m.home_team_id).push(Number(m.home_score));
    if (history.has(m.away_team_id)) history.get(m.away_team_id).push(Number(m.away_score));
  }

  // Roster-strength projection: optimal projected lineup per team
  const projections = await getWeekProjections({ season, week });
  const pointsFor = new Map(
    [...projections].map(([playerId, { points }]) => [playerId, points])
  );
  const { rosterSlots } = parseLineupSettings(league);
  const rosterResult = await pool.query(
    `SELECT "team_players"."team_id", "team_players"."player_id", "players"."position"
     FROM "team_players" JOIN "players" ON "players"."id" = "team_players"."player_id"
     WHERE "team_players"."league_id" = $1`,
    [leagueId]
  );
  const rosters = new Map(teams.map((t) => [t.id, []]));
  for (const row of rosterResult.rows) {
    if (rosters.has(row.team_id)) {
      rosters.get(row.team_id).push({ playerId: row.player_id, position: row.position });
    }
  }
  const models = new Map();
  for (const team of teams) {
    const projected = optimalLineup(rosters.get(team.id) || [], rosterSlots, pointsFor).total;
    models.set(team.id, buildTeamModel(history.get(team.id) || [], projected));
  }

  const standings = computeStandings(teams, matchupsResult.rows);
  const effectiveSeed = seed != null ? seed : leagueId * 1000 + week; // stable within a week
  let odds;
  if (league.season_status === 'playoffs') {
    // The regular season is decided: playoff odds are historical fact, and
    // title odds come from continuing the REAL bracket — alive teams only,
    // this round's pending pairings fixed, later rounds re-seeded.
    const playoffRows = matchupsResult.rows.filter((m) => m.is_playoff && !m.is_consolation);
    const qualifiers = new Set(
      standings.slice(0, Math.min(league.playoff_teams, teams.length)).map((s) => s.teamId)
    );
    const eliminated = new Set();
    for (const m of playoffRows.filter((r) => r.final)) {
      const loser =
        Number(m.home_score) >= Number(m.away_score) ? m.away_team_id : m.home_team_id;
      eliminated.add(loser);
    }
    const seedByTeam = new Map(standings.map((s, i) => [s.teamId, i + 1]));
    const aliveEntrants = [...qualifiers]
      .filter((teamId) => !eliminated.has(teamId))
      .map((teamId) => ({ teamId, seed: seedByTeam.get(teamId) ?? 99 }))
      .sort((a, b) => a.seed - b.seed);
    const fixedGames = playoffRows
      .filter((m) => !m.final)
      .map((m) => ({ home: m.home_team_id, away: m.away_team_id }));

    const rng = mulberry32(effectiveSeed);
    const titleCounts = new Map();
    for (let i = 0; i < runs; i++) {
      const champion = simulateBracketFrom({ aliveEntrants, fixedGames, models, rng });
      if (champion != null) titleCounts.set(champion, (titleCounts.get(champion) || 0) + 1);
    }
    odds = new Map(
      teams.map((t) => [
        t.id,
        {
          playoffOdds: qualifiers.has(t.id) ? 1 : 0,
          titleOdds: Math.round(((titleCounts.get(t.id) || 0) / runs) * 1000) / 1000,
        },
      ])
    );
  } else {
    odds = runSimulation({
      teams,
      playedMatchups: played,
      remainingMatchups: remaining,
      models,
      playoffTeams: league.playoff_teams,
      runs,
      seed: effectiveSeed,
    });
  }
  const rankings = powerRankings(standings, models, odds);

  const data = { computedAt: new Date().toISOString(), runs, rankings };
  await pool.query(
    `INSERT INTO "league_analytics" ("league_id", "season", "week", "type", "data")
     VALUES ($1, $2, $3, 'power_rankings', $4)
     ON CONFLICT ("league_id", "season", "week", "type")
     DO UPDATE SET "data" = EXCLUDED."data", "updated_at" = now()`,
    [leagueId, season, week, JSON.stringify(data)]
  );
  return data;
}

/**
 * Pure: merge each team's rank movement vs the previous stored week onto its
 * ranking row. `change` is prevRank - currentRank (positive = moved up,
 * negative = moved down, 0 = held, null = no prior week to compare against).
 */
function withRankChange(rankings, previousRankings) {
  const prevRankByTeam = new Map((previousRankings || []).map((r) => [r.teamId, r.rank]));
  return rankings.map((r) => {
    const prevRank = prevRankByTeam.get(r.teamId);
    return { ...r, change: prevRank != null ? prevRank - r.rank : null };
  });
}

/**
 * Latest stored power rankings for a league (any week this season), with
 * rank movement vs the previous stored week (each week is stored as its own
 * row, so history is already there — see league_analytics unique constraint).
 */
async function getLatestPowerRankings({ leagueId }) {
  const result = await pool.query(
    `SELECT "season", "week", "data" FROM "league_analytics"
     WHERE "league_id" = $1 AND "type" = 'power_rankings'
     ORDER BY "season" DESC, "week" DESC LIMIT 2`,
    [leagueId]
  );
  const latest = result.rows[0];
  if (!latest) return null;
  const previous = result.rows[1];
  const rankings = withRankChange(latest.data.rankings, previous ? previous.data.rankings : null);
  return { season: latest.season, week: latest.week, data: { ...latest.data, rankings } };
}

module.exports = {
  DEFAULT_RUNS,
  mulberry32,
  normalSample,
  meanAndStddev,
  buildTeamModel,
  simulateOnce,
  simulateBracketFrom,
  runSimulation,
  powerRankings,
  withRankChange,
  computeLeagueOdds,
  getLatestPowerRankings,
};
