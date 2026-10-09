const { mergePrefs } = require('./prefs.service');
const homeStatus = require('./homeStatus.service');

/**
 * Postgame cutscene (ADR 0052): the server half. A Manager's cutscene for a
 * Matchup is DUE when the Matchup is `final`, they hold a Team in it, no
 * `postgame_cutscene_views` row of theirs exists for it, and it has not
 * expired. Seen is a fact of the account, not of a browser, so it plays once
 * across every device.
 *
 * Expiry needs no column (see expiryOf): the last Kickoff of the week after
 * the Matchup's, else its last Kickoff plus 7 days. Scores are read live: a later stat correction
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

/**
 * Pure: when this Matchup's cutscene stops being due (ms). It is only ever the
 * result that just happened (ADR 0052): it expires at the last Kickoff of the
 * week AFTER the Matchup's own, however far current_week has run on, so a
 * result two weeks old carries nothing over. Whenever current_week = week + 1
 * this is the league's current week's last Kickoff. When the season is
 * complete, or that next week has no Kickoff on the schedule (it holds NFL
 * weeks 1-18 only), the bound is the Matchup week's last Kickoff + 7 days. With
 * no Kickoff known for either (playoff weeks past the schedule's 18), it is due
 * while current_week is at most one week on, and expired once the league is two
 * or more weeks past it, so an old playoff result cannot linger; only the newest
 * result of a finished season stays due until seen.
 * The instant itself is expired: a Kickoff locks inclusively everywhere else.
 */
function expiryOf({ league, matchup, kickoffs }) {
  if (league.season_status !== 'complete') {
    const next = kickoffs.get(weekKey(matchup.season, Number(matchup.week) + 1))?.last;
    if (next != null) return new Date(next).getTime();
  }
  const last = kickoffs.get(weekKey(matchup.season, matchup.week))?.last;
  if (last != null) return new Date(last).getTime() + SEVEN_DAYS_MS;
  return Number(league.current_week) >= Number(matchup.week) + 2 ? -Infinity : null;
}

/** Pure: win | loss | tie for the viewer's side, by computeStandings' comparison. */
function outcomeOf(mine, theirs) {
  if (mine > theirs) return 'win';
  if (mine < theirs) return 'loss';
  return 'tie';
}

const awardKey = (leagueId, season, week, teamId) => `${leagueId}:${season}:${week}:${teamId}`;
const upper = (text) => String(text).toUpperCase();
const AWARD_ORDER = ['called_shot', 'perfect_lineup', 'captain_hindsight'];

/**
 * The awards card's rows (ADR 0052 amendment), keyed by league, season, week and
 * the viewer's Team: the week's resolved called shot (hit or miss; a void is a
 * non-event), then Perfect Lineup, then Captain Hindsight, read from the frozen
 * rows the Settle follow-up wrote and never recomputed. The `called_shot` trophy
 * is not read: the called row already says hit or miss. A failed read costs the
 * card, never the result.
 */
async function loadAwards(db, due) {
  const byKey = new Map();
  const add = (key, award) => byKey.set(key, [...(byKey.get(key) || []), award]);
  try {
    const leagueIds = [...new Set(due.map(({ league }) => Number(league.id)))];
    const teamIds = [...new Set(due.map(({ league }) => Number(league.my_team_id)))];
    const seasons = [...new Set(due.map(({ row }) => Number(row.season)))];
    const weeks = [...new Set(due.map(({ row }) => Number(row.week)))];
    const params = [leagueIds, teamIds, seasons, weeks];
    const [shots, trophies] = await Promise.all([
      db.query(
        `SELECT "lineup_overrides"."league_id", "lineup_overrides"."team_id", "lineup_overrides"."season",
                "lineup_overrides"."week", "lineup_overrides"."outcome",
                "lineup_overrides"."starter_points_actual", "lineup_overrides"."benched_points_actual",
                "starter"."name" AS "starter_name", "benched"."name" AS "benched_name"
         FROM "lineup_overrides"
         JOIN "players" AS "starter" ON "starter"."id" = "lineup_overrides"."starter_player_id"
         JOIN "players" AS "benched" ON "benched"."id" = "lineup_overrides"."benched_player_id"
         WHERE "lineup_overrides"."league_id" = ANY($1) AND "lineup_overrides"."team_id" = ANY($2)
           AND "lineup_overrides"."season" = ANY($3) AND "lineup_overrides"."week" = ANY($4)
           AND "lineup_overrides"."called" AND "lineup_overrides"."outcome" IN ('hit', 'miss')
         ORDER BY "lineup_overrides"."id"`,
        params
      ),
      db.query(
        `SELECT "league_id", "team_id", "season", "week", "type", "data" FROM "trophies"
         WHERE "league_id" = ANY($1) AND "team_id" = ANY($2) AND "season" = ANY($3) AND "week" = ANY($4)
           AND "type" IN ('perfect_lineup', 'captain_hindsight')`,
        params
      ),
    ]);
    for (const r of shots.rows) {
      add(awardKey(r.league_id, r.season, r.week, r.team_id), {
        type: 'called_shot',
        label: `CALLED SHOT: ${upper(r.outcome)}`,
        detail: `${upper(r.starter_name)} OVER ${upper(r.benched_name)}, ${num(r.starter_points_actual)} TO ${num(r.benched_points_actual)}`,
      });
    }
    for (const r of trophies.rows) {
      const data = r.data || {};
      const key = awardKey(r.league_id, r.season, r.week, r.team_id);
      if (r.type === 'perfect_lineup') {
        add(key, { type: r.type, label: 'PERFECT LINEUP', detail: data.points == null ? null : `${data.points} PTS` });
      } else if (r.type === 'captain_hindsight') {
        add(key, {
          type: r.type,
          label: 'CAPTAIN HINDSIGHT',
          detail: data.benchPlayer && data.gain != null ? `${upper(data.benchPlayer)} WAS +${data.gain}` : null,
        });
      }
    }
  } catch (err) {
    console.error('postgame cutscene: award lookup failed:', err.message);
    byKey.clear();
  }
  for (const awards of byKey.values()) {
    awards.sort((a, b) => AWARD_ORDER.indexOf(a.type) - AWARD_ORDER.indexOf(b.type));
  }
  return byKey;
}

/**
 * Each due Matchup's stored postgame Narrative (ADR 0061), keyed by Matchup id.
 * Display data: a failed read costs the line, never the cutscene.
 */
async function loadNarratives(db, due) {
  const byMatchup = new Map();
  try {
    const { rows } = await db.query(
      `SELECT "league_id", "season", "week", "data" FROM "league_analytics"
       WHERE "type" = 'matchup_narratives' AND "league_id" = ANY($1)
         AND "season" = ANY($2) AND "week" = ANY($3)`,
      [
        [...new Set(due.map(({ league }) => Number(league.id)))],
        [...new Set(due.map(({ row }) => Number(row.season)))],
        [...new Set(due.map(({ row }) => Number(row.week)))],
      ]
    );
    const stored = new Map(rows.map((r) => [`${r.league_id}:${r.season}:${r.week}`, r.data?.matchups || {}]));
    for (const { row, league } of due) {
      const text = stored.get(`${league.id}:${row.season}:${row.week}`)?.[row.id]?.postgame?.narrative;
      if (text) byMatchup.set(Number(row.id), text);
    }
  } catch (err) {
    console.error('postgame cutscene: narrative lookup failed:', err.message);
  }
  return byMatchup;
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
  for (const { row } of candidates) {
    for (const [season, week] of [[row.season, Number(row.week) + 1], [row.season, row.week]]) {
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

  const awardsByKey = due.length > 0 ? await loadAwards(db, due) : new Map();
  const narrativeByMatchup = due.length > 0 ? await loadNarratives(db, due) : new Map();
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
      awards: awardsByKey.get(awardKey(leagueId, row.season, row.week, myId)) || [],
      narrative: narrativeByMatchup.get(Number(row.id)) ?? null,
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
 * that Matchup, or it does not exist or is not final yet; true once it is recorded.
 */
async function markSeen({ userId, matchupId, db }) {
  const found = await db.query(
    `SELECT "id", "league_id", "home_team_id", "away_team_id", "final" FROM "matchups" WHERE "id" = $1`,
    [matchupId]
  );
  const matchup = found.rows[0];
  if (!matchup || !matchup.final) return false; // an open Matchup has no cutscene to have seen
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
