const { mergePrefs } = require('./prefs.service');
const homeStatus = require('./homeStatus.service');

/**
 * Postgame cutscene (ADR 0052): the server half. A Manager's cutscene for a
 * Matchup is DUE when the Matchup is `final`, they hold a Team in it, no
 * `postgame_cutscene_views` row of theirs exists for it, and it has not
 * expired. Seen is a fact of the account, not of a browser, so it plays once
 * across every device.
 *
 * Expiry needs no column. It is the earliest Kickoff of the league's
 * `current_week` when that week is later than the Matchup's (the next week is
 * about to lock), and the Matchup week's last Kickoff plus 7 days when it is
 * not (the season is complete). Scores are read live: a later stat correction
 * changes the score shown to a Manager who has not looked yet and never
 * re-opens a Matchup that was seen.
 *
 * The reads compose over homeStatus.service's loaders (week Kickoffs, league
 * Teams, season Matchups) and season.service's computeStandings, so a
 * cutscene can never disagree with the league card about a Record. Team
 * identity only on the wire: Team ID, name, avatar; never a username, email
 * or user id.
 */

const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000;

// homeStatus keys its kickoff map by "season:week"; the same format, kept
// local so the loader's key stays its own business.
const weekKey = (season, week) => `${season}:${week}`;

const num = (value) => (value == null ? null : Number(value));

/** Pure: the earliest Kickoff (ms) of a week's `{ byTeam }` entry, null with none. */
function earliestKickoff(entry) {
  if (!entry) return null;
  let earliest = null;
  for (const kickoff of entry.byTeam.values()) {
    const at = new Date(kickoff).getTime();
    if (earliest === null || at < earliest) earliest = at;
  }
  return earliest;
}

/**
 * Pure: when this Matchup's cutscene stops being due (ms), null when the
 * schedule names no Kickoff to expire against. The instant itself is expired:
 * a Kickoff locks inclusively everywhere else.
 */
function expiryOf({ league, matchup, kickoffs }) {
  if (Number(league.current_week) > Number(matchup.week)) {
    return earliestKickoff(kickoffs.get(weekKey(league.current_season, league.current_week)));
  }
  const last = kickoffs.get(weekKey(matchup.season, matchup.week))?.last;
  return last == null ? null : new Date(last).getTime() + SEVEN_DAYS_MS;
}

/** Pure: win | loss | tie for the viewer's side, by computeStandings' comparison. */
function outcomeOf(mine, theirs) {
  if (mine > theirs) return 'win';
  if (mine < theirs) return 'loss';
  return 'tie';
}

/** The viewer's `postgameCutscenes` preference; opt-out, so unset is on. */
async function cutscenesWanted({ userId, db }) {
  const result = await db.query(
    `SELECT "prefs" FROM "notification_prefs" WHERE "user_id" = $1`,
    [userId]
  );
  return mergePrefs(result.rows[0] && result.rows[0].prefs).postgameCutscenes;
}

/**
 * The viewer's Postgame cutscenes that are due at `now`, sorted by league
 * name, then league id (then week and Matchup id). One batched read per
 * table across every league the viewer is in.
 */
async function listDue({ userId, now, db }) {
  if (!(await cutscenesWanted({ userId, db }))) return [];

  const leagues = await homeStatus.listMyLeagues(db, userId);
  if (leagues.length === 0) return [];
  const leagueById = new Map(leagues.map((l) => [Number(l.id), l]));

  const matchupsByLeague = await homeStatus.loadSeasonMatchups(db, { userId, leagueIds: [...leagueById.keys()] });
  const candidates = [];
  for (const [leagueId, rows] of matchupsByLeague) {
    const league = leagueById.get(Number(leagueId));
    if (!league) continue;
    for (const row of rows) {
      const home = Number(row.home_team_id) === Number(league.my_team_id);
      const away = Number(row.away_team_id) === Number(league.my_team_id);
      if (row.final && (home || away)) candidates.push({ row, league, home });
    }
  }
  if (candidates.length === 0) return [];

  const dueLeagueIds = [...new Set(candidates.map((c) => Number(c.league.id)))];
  const teamIds = [...new Set(candidates.flatMap((c) => [Number(c.row.home_team_id), Number(c.row.away_team_id)]))];
  const weeks = new Map();
  for (const { row, league } of candidates) {
    for (const [season, week] of [[league.current_season, league.current_week], [row.season, row.week]]) {
      weeks.set(weekKey(season, week), { season: Number(season), week: Number(week) });
    }
  }

  const [seen, kickoffs, teamsByLeague, avatars] = await Promise.all([
    db.query(
      `SELECT "matchup_id" FROM "postgame_cutscene_views"
       WHERE "user_id" = $1 AND "matchup_id" = ANY($2)`,
      [userId, candidates.map((c) => c.row.id)]
    ),
    homeStatus.loadWeekKickoffs(db, { weeks: [...weeks.values()] }),
    homeStatus.loadLeagueTeams(db, { userId, leagueIds: dueLeagueIds }),
    db.query(
      `SELECT "id", "avatar_url", "avatar_static_url" FROM "teams" WHERE "id" = ANY($1)`,
      [teamIds]
    ),
  ]);
  const seenIds = new Set(seen.rows.map((r) => Number(r.matchup_id)));
  const avatarById = new Map(avatars.rows.map((r) => [Number(r.id), r]));
  const nowMs = new Date(now).getTime();

  const due = candidates.filter(({ row, league }) => {
    if (seenIds.has(Number(row.id))) return false;
    const expiry = expiryOf({ league, matchup: row, kickoffs });
    return expiry === null || nowMs < expiry;
  });

  const { computeStandings } = require('./season.service');
  const standingsByLeague = new Map();
  const items = due.map(({ row, league, home }) => {
    const leagueId = Number(league.id);
    const leagueTeams = teamsByLeague.get(leagueId) || [];
    if (!standingsByLeague.has(leagueId)) {
      standingsByLeague.set(leagueId, computeStandings(leagueTeams, matchupsByLeague.get(leagueId) || []));
    }
    const standings = standingsByLeague.get(leagueId);
    const nameById = new Map(leagueTeams.map((t) => [Number(t.id), t.name]));
    const side = (teamId, score) => ({
      teamId,
      name: nameById.get(teamId) ?? null,
      avatarUrl: avatarById.get(teamId)?.avatar_url ?? null,
      avatarStaticUrl: avatarById.get(teamId)?.avatar_static_url ?? null,
      score,
    });
    const myId = Number(league.my_team_id);
    const oppId = Number(home ? row.away_team_id : row.home_team_id);
    const myScore = num(home ? row.home_score : row.away_score);
    const oppScore = num(home ? row.away_score : row.home_score);
    const playoff = Boolean(row.is_playoff);
    const mine = playoff ? null : standings.find((s) => Number(s.teamId) === myId);
    return {
      matchupId: Number(row.id),
      leagueId,
      leagueName: league.name,
      season: Number(row.season),
      week: Number(row.week),
      playoff,
      outcome: outcomeOf(myScore, oppScore),
      me: side(myId, myScore),
      opponent: side(oppId, oppScore),
      record: mine ? { wins: mine.wins, losses: mine.losses, ties: mine.ties } : null,
      standing: mine ? { rank: mine.rank, of: standings.length } : null,
    };
  });

  return items.sort((a, b) =>
    String(a.leagueName).localeCompare(String(b.leagueName))
    || a.leagueId - b.leagueId
    || a.week - b.week
    || a.matchupId - b.matchupId);
}

/**
 * Mark a Matchup's cutscene seen for the viewer. Idempotent (ON CONFLICT DO
 * NOTHING). Returns false, writing nothing, when the viewer holds no Team in
 * that Matchup (or it does not exist); true once it is recorded.
 */
async function markSeen({ userId, matchupId, db }) {
  const found = await db.query(
    `SELECT "id", "league_id", "home_team_id", "away_team_id" FROM "matchups" WHERE "id" = $1`,
    [matchupId]
  );
  const matchup = found.rows[0];
  if (!matchup) return false;
  const leagues = await homeStatus.listMyLeagues(db, userId);
  const league = leagues.find((l) => Number(l.id) === Number(matchup.league_id));
  const inIt = league
    && [Number(matchup.home_team_id), Number(matchup.away_team_id)].includes(Number(league.my_team_id));
  if (!inIt) return false;
  await db.query(
    `INSERT INTO "postgame_cutscene_views" ("user_id", "matchup_id") VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [userId, matchupId]
  );
  return true;
}

module.exports = { listDue, markSeen };
