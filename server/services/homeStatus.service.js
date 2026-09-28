const { injuryDesignationName, isValidStash } = require('./irPolicy.service');
const { normalizeNflTeam } = require('./nflTeam');
const { deriveLeaguePhase, LEAGUE_PHASE } = require('./leaguePhase');
const { isPickemOnly } = require('./leagueType');

/**
 * Home status: the answers the pre-lockout digests, the Home to-do list
 * (GET /api/user/action-items) and the league status cards
 * (GET /api/league?include=status) all ask of a lineup and a Pick'em week -
 * "is a slot empty", "is a starter out", "how many picks are still open",
 * "when does it lock". One module, so an email, a card and a to-do row built
 * from the same rows can never disagree.
 *
 * The builders here are pure over rows the callers already read; the digest
 * keeps its own per-league queries and the Home endpoints batch theirs across
 * the viewer's leagues, but both hand the same row shapes to the same
 * builders.
 */

/**
 * Pure: problems in a lineup that should trigger a pre-lockout reminder.
 * entries: [{ slot, name, onBye, injury_status, ir_attested }] (starter
 * availability and unresolved IR stashes are flagged; BENCH is ignored and a
 * commissioner-attested stash never nags). rosterSlots:
 * [{key,count,...}] detects unfilled slots.
 * Returns human-readable problem strings (empty = lineup looks fine).
 */
function lineupProblems(entries, rosterSlots = []) {
  const problems = [];
  const starters = entries.filter((e) => e.slot !== 'BENCH' && e.slot !== 'IR');

  const filled = {};
  for (const s of starters) filled[s.slot] = (filled[s.slot] || 0) + 1;
  for (const { key: slot, count } of rosterSlots) {
    const have = filled[slot] || 0;
    if (have < count) {
      problems.push(`${count - have} empty ${slot} slot${count - have === 1 ? '' : 's'}`);
    }
  }

  for (const s of starters) {
    if (s.onBye) problems.push(`${s.name} (${s.slot}) is on bye`);
    else if (s.injury_status === 'O' || s.injury_status === 'IR') {
      problems.push(`${s.name} (${s.slot}) is ${s.injury_status === 'O' ? 'Out' : 'on IR'}`);
    }
  }
  for (const stash of entries.filter((entry) => entry.slot === 'IR')) {
    // A commissioner-attested stash is valid by fiat (#100) - never nagged.
    if (!isValidStash(stash)) {
      problems.push(
        `${stash.name} (IR) is no longer IR-eligible (${injuryDesignationName(stash.injury_status)})`
      );
    }
  }
  return problems;
}

/**
 * Pure: one lineup_entries row (joined to players, with the week's bye read
 * off the nfl_games LEFT JOIN as `on_bye`) in the shape `lineupProblems`
 * reads.
 */
function lineupEntryFromRow(row) {
  return {
    slot: row.slot,
    name: row.name,
    onBye: row.on_bye,
    injury_status: row.injury_status,
    ir_attested: row.ir_attested,
  };
}

/**
 * Pure: the league-type rule over `lineupProblems`. A best-ball league has no
 * set lineup (the optimizer picks the starters), so only its unresolved IR
 * stashes are the manager's to fix; every other league is checked in full
 * against its roster slots.
 */
function leagueLineupProblems({ entries, rosterSlots, bestBall }) {
  return bestBall
    ? lineupProblems(entries.filter((entry) => entry.slot === 'IR'), [])
    : lineupProblems(entries, rosterSlots);
}

/**
 * Pure: the slate's game keys that have NOT locked at `now` (a game locks
 * inclusively at kickoff, pickem.service's isGameLocked). Games already past
 * kickoff are excluded: there is nothing left for the manager to do about
 * those.
 */
function openGameKeys(slate, now) {
  // Required lazily, the way the digest always reached pickem.service: this
  // module sits under the digest's own require and needs one pure helper.
  const { isGameLocked } = require('./pickem.service');
  return slate.filter((game) => !isGameLocked(game, now)).map((game) => game.gameKey);
}

/** Pure: pickem_picks rows ({ user_id, team_pair }) -> Map<user_id, Set<team_pair>>. */
function picksMadeByUser(rows) {
  const madeByUser = new Map();
  for (const row of rows) {
    if (!madeByUser.has(row.user_id)) madeByUser.set(row.user_id, new Set());
    madeByUser.get(row.user_id).add(row.team_pair);
  }
  return madeByUser;
}

/** Pure: the open game keys this manager has not picked yet. */
function missingPicks(openKeys, made = new Set()) {
  return openKeys.filter((gameKey) => !made.has(gameKey));
}

const iso = (value) => (value == null ? null : new Date(value).toISOString());
const timeOf = (value) => (value == null ? NaN : new Date(value).getTime());

/**
 * Pure: a lineup's Home status, `{ emptySlots, problems, nextLockAt }`, the
 * one answer behind the league card's lineup line and the lineup_problem
 * to-do row. Unlike the digest (which only ever runs in the two hours before
 * a kickoff), Home asks at any hour, so this is lock-aware:
 *
 *  - A starter whose own game has kicked off (inclusively, the lock rule
 *    lineup.service's lockedPlayerIds applies) still fills his seat, but his
 *    bye or injury is no longer something the manager can act on, so it is not
 *    a problem; a locked IR stash can no longer move either and is dropped.
 *  - After the week's last kickoff nothing is actionable at all: no seat can
 *    be filled, so the answer is empty with no lock.
 *  - `nextLockAt` is the earliest kickoff still ahead among the roster's NFL
 *    teams, else the week's last kickoff (a free agent in a later game could
 *    still fill an empty seat), else null.
 *
 * The problem strings are `leagueLineupProblems`' own, so an email and a card
 * never word the same lineup two ways. Best ball carries no `emptySlots` (the
 * optimizer fills the seats; only IR problems are the manager's), matching the
 * digest.
 *
 * entries: [{ slot, name, onBye, injury_status, ir_attested, nflTeam }];
 * kickoffByTeam: Map<normalized team code, kickoff>; weekLastKickoff: the
 * week's last kickoff or null when the week has no schedule.
 */
function lineupStatus({ entries, rosterSlots, bestBall, kickoffByTeam, weekLastKickoff, now }) {
  const nowMs = timeOf(now);
  const kickoffOf = (e) => (kickoffByTeam && kickoffByTeam.get(normalizeNflTeam(e.nflTeam))) || null;
  const locked = (e) => {
    const at = timeOf(kickoffOf(e));
    return Number.isFinite(at) && at <= nowMs;
  };
  // Best ball has no seats for the manager to fill, so no emptySlots key.
  const withEmpty = ({ emptySlots, ...rest }) => (bestBall ? rest : { emptySlots, ...rest });

  if (Number.isFinite(timeOf(weekLastKickoff)) && timeOf(weekLastKickoff) <= nowMs) {
    return withEmpty({ emptySlots: [], problems: [], nextLockAt: null });
  }

  const actionable = [];
  for (const e of entries) {
    if (!locked(e)) actionable.push(e);
    else if (e.slot !== 'IR') {
      // Locked starter (or bench): keeps his seat, sheds what he can no
      // longer be moved for.
      actionable.push({ ...e, onBye: false, injury_status: null });
    }
  }
  const problems = leagueLineupProblems({ entries: actionable, rosterSlots, bestBall });

  const emptySlots = [];
  if (!bestBall) {
    const filled = {};
    for (const e of entries) {
      if (e.slot !== 'BENCH' && e.slot !== 'IR') filled[e.slot] = (filled[e.slot] || 0) + 1;
    }
    for (const { key, count } of rosterSlots || []) {
      for (let seat = filled[key] || 0; seat < count; seat += 1) emptySlots.push(key);
    }
  }

  let next = null;
  for (const e of entries) {
    const at = timeOf(kickoffOf(e));
    if (Number.isFinite(at) && at > nowMs && (next === null || at < next)) next = at;
  }
  if (next === null && Number.isFinite(timeOf(weekLastKickoff))) next = timeOf(weekLastKickoff);

  return withEmpty({ emptySlots, problems, nextLockAt: next === null ? null : iso(next) });
}

/**
 * Pure: a manager's Pick'em week, `{ made, total, missing, nextLockAt }`, the
 * one answer behind the league card's pick'em line and the picks_open to-do
 * row. `made` counts the manager's picks among THIS week's slate games (open
 * or locked), `total` is the slate, `missing` the open games still unpicked
 * (the digest's own `missingPicks` over `openGameKeys`), and `nextLockAt` the
 * earliest kickoff among those, or null when nothing is left to pick.
 */
function pickemStatus({ slate, made = new Set(), now }) {
  const missing = new Set(missingPicks(openGameKeys(slate, now), made));
  let next = null;
  for (const game of slate) {
    if (!missing.has(game.gameKey)) continue;
    const at = timeOf(game.kickoffAt);
    if (Number.isFinite(at) && (next === null || at < next)) next = at;
  }
  return {
    made: slate.filter((game) => made.has(game.gameKey)).length,
    total: slate.length,
    missing: missing.size,
    nextLockAt: next === null ? null : iso(next),
  };
}

/**
 * Pure: this week's matchup from the caller's side, for the league card.
 * `decoration` is expectedFinal.service decorateMatchups' entry for the row
 * (its `status` is the ADR 0030 server fact, null when it could not be
 * computed). winProbability stays null in this pass: v2 is in shadow, and the
 * client runs v1 on the two expected finals meanwhile.
 */
function matchupSummary({ matchup, decoration, myTeamId, teamNameById }) {
  const home = Number(matchup.home_team_id) === Number(myTeamId);
  const score = (value) => (value == null ? null : Number(value));
  const side = (isHome) => ({
    score: score(isHome ? matchup.home_score : matchup.away_score),
    expectedFinal: isHome ? decoration.homeExpectedFinal : decoration.awayExpectedFinal,
    playersRemaining: isHome ? decoration.homePlayersRemaining : decoration.awayPlayersRemaining,
  });
  const opponentId = Number(home ? matchup.away_team_id : matchup.home_team_id);
  return {
    id: matchup.id,
    status: decoration.status,
    opponent: { teamId: opponentId, name: teamNameById.get(opponentId) ?? null },
    my: side(home),
    opp: side(!home),
    winProbability: null,
  };
}

/* ------------------------------------------------------------------ *
 * Batched reads for the Home endpoints. Every read covers ALL of the   *
 * viewer's leagues at once (= ANY), so the query count never grows     *
 * with the number of leagues, and every read of league data is scoped  *
 * to the viewer through teams.owner_id. The schedule reads (kickoffs,  *
 * the Pick'em slate) are public NFL facts and run once per distinct    *
 * (season, week) in play, not per league.                              *
 *                                                                      *
 * Heavier services are required lazily inside each loader: the digest  *
 * requires this module at load time, and its load graph stays as it    *
 * was.                                                                 *
 * ------------------------------------------------------------------ */

const weekKey = (season, week) => `${season}:${week}`;

/** Pure: does this league have a fantasy week in play (lineups, matchups, standings)? */
function fantasyWeekApplies(league, phase = deriveLeaguePhase(league)) {
  return !isPickemOnly(league) && (phase === LEAGUE_PHASE.IN_SEASON || phase === LEAGUE_PHASE.PLAYOFFS);
}

/** Distinct { season, week } pairs for these leagues' current weeks. */
function currentWeeks(leagues) {
  const weeks = new Map();
  for (const league of leagues) {
    const key = weekKey(league.current_season, league.current_week);
    if (!weeks.has(key)) weeks.set(key, { season: Number(league.current_season), week: Number(league.current_week) });
  }
  return [...weeks.values()];
}

/**
 * The viewer's lineup entries for each of their teams' current week, as
 * Map<teamId, entries[]> in `lineupStatus`'s shape (with `nflTeam`).
 *
 * Read-only, so unlike the digest it does not materialize the week first.
 * Instead it reads each team's latest week at or before the current one:
 * `materializeLineup`'s copy-forward seeds an untouched week from exactly
 * that week (a newly added player lands on the bench, which never changes a
 * problem, and a dropped player is left out by the team_players join, as in
 * the digest), so Tuesday's Home page reads the lineup Sunday will start
 * from rather than nine false empty seats. The bye is read against the
 * CURRENT week, with the digest's fn_normalize_nfl_team join (#287).
 */
async function loadLineups(db, { userId, teamIds }) {
  const byTeam = new Map();
  if (teamIds.length === 0) return byTeam;
  const result = await db.query(
    `WITH "source" AS (
       SELECT "lineup_entries"."team_id", MAX("lineup_entries"."week") AS "week"
       FROM "lineup_entries"
       JOIN "teams" ON "teams"."id" = "lineup_entries"."team_id"
       JOIN "leagues" ON "leagues"."id" = "teams"."league_id"
       WHERE "teams"."owner_id" = $1 AND "teams"."id" = ANY($2)
         AND "lineup_entries"."season" = "leagues"."current_season"
         AND "lineup_entries"."week" <= "leagues"."current_week"
       GROUP BY "lineup_entries"."team_id"
     )
     SELECT "lineup_entries"."team_id", "lineup_entries"."slot", "lineup_entries"."ir_attested",
            "players"."name", "players"."injury_status", "players"."nfl_team",
            ("nfl_games"."nfl_team" IS NULL) AS "on_bye"
     FROM "source"
     JOIN "teams" ON "teams"."id" = "source"."team_id"
     JOIN "leagues" ON "leagues"."id" = "teams"."league_id"
     JOIN "lineup_entries" ON "lineup_entries"."team_id" = "source"."team_id"
       AND "lineup_entries"."season" = "leagues"."current_season"
       AND "lineup_entries"."week" = "source"."week"
     JOIN "team_players" ON "team_players"."team_id" = "lineup_entries"."team_id"
       AND "team_players"."player_id" = "lineup_entries"."player_id"
     JOIN "players" ON "players"."id" = "lineup_entries"."player_id"
     LEFT JOIN "nfl_games" ON "nfl_games"."season" = "leagues"."current_season"
       AND "nfl_games"."week" = "leagues"."current_week"
       AND fn_normalize_nfl_team("nfl_games"."nfl_team") = fn_normalize_nfl_team("players"."nfl_team")
     WHERE "teams"."owner_id" = $1`,
    [userId, teamIds]
  );
  for (const row of result.rows) {
    if (!byTeam.has(row.team_id)) byTeam.set(row.team_id, []);
    byTeam.get(row.team_id).push({ ...lineupEntryFromRow(row), nflTeam: row.nfl_team });
  }
  return byTeam;
}

/**
 * The week's kickoffs for each (season, week) in play, as
 * Map<weekKey, { byTeam: Map<team code, kickoff>, last }>. The same fold
 * lineup.service's kickedOffTeams / weekKickoffs apply (normalized team code,
 * the earliest instant per team, inclusive lock at kickoff), batched across
 * weeks into one read rather than one per league.
 */
async function loadWeekKickoffs(db, { weeks }) {
  const byWeek = new Map();
  if (weeks.length === 0) return byWeek;
  const result = await db.query(
    `SELECT "nfl_games"."season", "nfl_games"."week", "nfl_games"."nfl_team", "nfl_games"."kickoff_at"
     FROM "nfl_games"
     JOIN unnest($1::int[], $2::int[]) AS "weeks"("season", "week")
       ON "weeks"."season" = "nfl_games"."season" AND "weeks"."week" = "nfl_games"."week"
     WHERE "nfl_games"."kickoff_at" IS NOT NULL`,
    [weeks.map((w) => w.season), weeks.map((w) => w.week)]
  );
  for (const w of weeks) byWeek.set(weekKey(w.season, w.week), { byTeam: new Map(), last: null });
  for (const row of result.rows) {
    const entry = byWeek.get(weekKey(row.season, row.week));
    const team = normalizeNflTeam(row.nfl_team);
    if (!entry || team === null) continue;
    const held = entry.byTeam.get(team);
    if (held === undefined || timeOf(row.kickoff_at) < timeOf(held)) entry.byTeam.set(team, row.kickoff_at);
    if (entry.last === null || timeOf(row.kickoff_at) > timeOf(entry.last)) entry.last = row.kickoff_at;
  }
  return byWeek;
}

/**
 * Which of these leagues have Pick'em on: every pick'em-only league, plus a
 * fantasy league whose pickem_settings row is enabled (no row means off,
 * pickem.service getSettings). Returns a Set of league ids.
 */
async function loadPickemLeagueIds(db, { userId, leagues }) {
  const on = new Set(leagues.filter(isPickemOnly).map((l) => l.id));
  const fantasyIds = leagues.filter((l) => !isPickemOnly(l)).map((l) => l.id);
  if (fantasyIds.length === 0) return on;
  const result = await db.query(
    `SELECT "pickem_settings"."league_id", "pickem_settings"."enabled"
     FROM "pickem_settings"
     JOIN "teams" ON "teams"."league_id" = "pickem_settings"."league_id" AND "teams"."owner_id" = $1
     WHERE "pickem_settings"."league_id" = ANY($2)`,
    [userId, fantasyIds]
  );
  for (const row of result.rows) if (row.enabled) on.add(row.league_id);
  return on;
}

/**
 * The Pick'em week for each of these leagues: Map<leagueId, pickemStatus>.
 * One slate per distinct (season, week) through pickem.service getWeekSlate,
 * and the viewer's own picks for every league's current week in one read.
 */
async function loadPickemWeeks(db, { userId, leagues, now }) {
  const out = new Map();
  if (leagues.length === 0) return out;
  const pickem = require('./pickem.service');
  const weeks = currentWeeks(leagues);
  const [slates, picks] = await Promise.all([
    Promise.all(weeks.map((w) => pickem.getWeekSlate({ season: w.season, week: w.week, db }))),
    db.query(
      `SELECT "pickem_picks"."league_id", "pickem_picks"."team_pair"
       FROM "pickem_picks"
       JOIN "leagues" ON "leagues"."id" = "pickem_picks"."league_id"
       JOIN "teams" ON "teams"."league_id" = "pickem_picks"."league_id" AND "teams"."owner_id" = $1
       WHERE "pickem_picks"."user_id" = $1 AND "pickem_picks"."league_id" = ANY($2)
         AND "pickem_picks"."season" = "leagues"."current_season"
         AND "pickem_picks"."week" = "leagues"."current_week"`,
      [userId, leagues.map((l) => l.id)]
    ),
  ]);
  const slateByWeek = new Map(weeks.map((w, i) => [weekKey(w.season, w.week), slates[i]]));
  const madeByLeague = new Map();
  for (const row of picks.rows) {
    if (!madeByLeague.has(row.league_id)) madeByLeague.set(row.league_id, new Set());
    madeByLeague.get(row.league_id).add(row.team_pair);
  }
  for (const league of leagues) {
    out.set(league.id, pickemStatus({
      slate: slateByWeek.get(weekKey(league.current_season, league.current_week)) || [],
      made: madeByLeague.get(league.id),
      now,
    }));
  }
  return out;
}

/** The teams of these leagues (the viewer's leagues only), as Map<leagueId, teams[]>. */
async function loadLeagueTeams(db, { userId, leagueIds }) {
  const result = await db.query(
    `SELECT "teams"."id", "teams"."league_id", "teams"."name" FROM "teams"
     WHERE "teams"."league_id" = ANY($2)
       AND EXISTS (SELECT 1 FROM "teams" "mine"
                   WHERE "mine"."league_id" = "teams"."league_id" AND "mine"."owner_id" = $1)`,
    [userId, leagueIds]
  );
  const byLeague = new Map();
  for (const row of result.rows) {
    if (!byLeague.has(row.league_id)) byLeague.set(row.league_id, []);
    byLeague.get(row.league_id).push(row);
  }
  return byLeague;
}

/** This season's matchups for these leagues (the viewer's leagues only), as Map<leagueId, rows[]>. */
async function loadSeasonMatchups(db, { userId, leagueIds }) {
  const result = await db.query(
    `SELECT "matchups"."id", "matchups"."league_id", "matchups"."season", "matchups"."week",
            "matchups"."home_team_id", "matchups"."away_team_id",
            "matchups"."home_score", "matchups"."away_score", "matchups"."final", "matchups"."is_playoff"
     FROM "matchups"
     JOIN "leagues" ON "leagues"."id" = "matchups"."league_id"
       AND "matchups"."season" = "leagues"."current_season"
     WHERE "matchups"."league_id" = ANY($2)
       AND EXISTS (SELECT 1 FROM "teams" "mine"
                   WHERE "mine"."league_id" = "matchups"."league_id" AND "mine"."owner_id" = $1)`,
    [userId, leagueIds]
  );
  const byLeague = new Map();
  for (const row of result.rows) {
    if (!byLeague.has(row.league_id)) byLeague.set(row.league_id, []);
    byLeague.get(row.league_id).push(row);
  }
  return byLeague;
}

/**
 * A failed batched read is remembered, not thrown: only the leagues that need
 * it fail (status null, statusError true), and `need` rethrows it inside that
 * league's own build.
 */
const settle = (promise) => promise.then((value) => ({ ok: true, value }), (error) => ({ ok: false, error }));
const need = (settled) => {
  if (!settled.ok) throw settled.error;
  return settled.value;
};

/**
 * The lineup status of each of these fantasy leagues' viewer team:
 * Map<leagueId, lineupStatus> over two batched reads (entries, kickoffs).
 * The one source behind the card's lineup line and the lineup_problem row.
 */
async function loadLineupStatuses(db, { userId, leagues, now }) {
  const { parseLineupSettings } = require('./lineup.service');
  const [lineups, kickoffs] = await Promise.all([
    loadLineups(db, { userId, teamIds: leagues.map((l) => l.my_team_id) }),
    loadWeekKickoffs(db, { weeks: currentWeeks(leagues) }),
  ]);
  const out = new Map();
  for (const league of leagues) {
    const week = kickoffs.get(weekKey(league.current_season, league.current_week)) || { byTeam: new Map(), last: null };
    out.set(league.id, lineupStatus({
      entries: lineups.get(league.my_team_id) || [],
      rosterSlots: parseLineupSettings(league).rosterSlots,
      bestBall: Boolean(league.best_ball),
      kickoffByTeam: week.byTeam,
      weekLastKickoff: week.last,
      now,
    }));
  }
  return out;
}

/**
 * GET /api/league?include=status: Map<leagueId, { status, statusError }> for
 * the caller's league list rows (each a `leagues.*` row plus the list's
 * my_team_* and team_count columns). Keys appear only where they apply:
 * week, record, standing, matchup and lineup for a fantasy league in season
 * or playoffs (matchup null on a bye), pickem while Pick'em is on and the
 * season is not complete, draft before and during the draft. Each league is
 * built in its own try/catch, and this function never throws: the list never
 * fails because of status.
 */
async function leagueStatuses(db, { userId, leagues, now }) {
  const out = new Map();
  const failAll = (error) => {
    console.error('home status: league statuses unavailable', error);
    for (const league of leagues) out.set(league.id, { status: null, statusError: true });
    return out;
  };
  try {
    const { computeStandings } = require('./season.service');
    const expectedFinal = require('./expectedFinal.service');
    const phaseOf = new Map(leagues.map((l) => [l.id, deriveLeaguePhase(l)]));
    const fantasy = leagues.filter((l) => fantasyWeekApplies(l, phaseOf.get(l.id)));
    const fantasyIds = fantasy.map((l) => l.id);
    const running = leagues.filter((l) => phaseOf.get(l.id) !== LEAGUE_PHASE.COMPLETE);

    const [pickemIds, teams, matchups, lineups] = await Promise.all([
      settle(loadPickemLeagueIds(db, { userId, leagues: running })),
      settle(fantasy.length ? loadLeagueTeams(db, { userId, leagueIds: fantasyIds }) : Promise.resolve(new Map())),
      settle(fantasy.length ? loadSeasonMatchups(db, { userId, leagueIds: fantasyIds }) : Promise.resolve(new Map())),
      settle(loadLineupStatuses(db, { userId, leagues: fantasy, now })),
    ]);
    // A league's Pick'em is on for sure when it is pick'em-only; a fantasy
    // league's answer needs the settings read, so a failed read fails it.
    const pickemOn = (league) => isPickemOnly(league) || need(pickemIds).has(league.id);
    const pickemLeagues = running.filter((l) => isPickemOnly(l) || (pickemIds.ok && pickemIds.value.has(l.id)));
    const pickemWeeks = await settle(loadPickemWeeks(db, { userId, leagues: pickemLeagues, now }));

    // This week's matchup for each fantasy league, decorated in parallel (one
    // expectedFinalsForWeek per league with an open matchup; a final one
    // reads nothing). decorateMatchups states an unreadable week as status
    // null itself, so a projection outage never fails the card.
    const current = new Map();
    if (matchups.ok) {
      await Promise.all(fantasy.map(async (league) => {
        const row = (matchups.value.get(league.id) || []).find((m) =>
          Number(m.week) === Number(league.current_week)
          && (Number(m.home_team_id) === Number(league.my_team_id) || Number(m.away_team_id) === Number(league.my_team_id)));
        if (!row) return;
        const [decoration] = await expectedFinal.decorateMatchups([row], { league, db, now });
        current.set(league.id, { row, decoration });
      }));
    }

    for (const league of leagues) {
      try {
        const phase = phaseOf.get(league.id);
        const status = { phase };
        if (fantasyWeekApplies(league, phase)) {
          const leagueTeams = need(teams).get(league.id) || [];
          const seasonMatchups = need(matchups).get(league.id) || [];
          const standings = computeStandings(leagueTeams, seasonMatchups);
          const mine = standings.find((s) => Number(s.teamId) === Number(league.my_team_id));
          const thisWeek = current.get(league.id);
          status.week = Number(league.current_week);
          status.record = mine ? { wins: mine.wins, losses: mine.losses, ties: mine.ties } : null;
          status.standing = mine ? { rank: mine.rank, of: standings.length } : null;
          status.matchup = thisWeek
            ? matchupSummary({
              matchup: thisWeek.row,
              decoration: thisWeek.decoration,
              myTeamId: league.my_team_id,
              teamNameById: new Map(leagueTeams.map((t) => [Number(t.id), t.name])),
            })
            : null;
          status.lineup = need(lineups).get(league.id);
        } else if (isPickemOnly(league) && phase !== LEAGUE_PHASE.COMPLETE) {
          status.week = Number(league.current_week);
        }
        if (phase !== LEAGUE_PHASE.COMPLETE && pickemOn(league)) {
          const { made, total, nextLockAt } = need(pickemWeeks).get(league.id);
          status.pickem = { made, total, nextLockAt };
        }
        if (phase === LEAGUE_PHASE.PRE_DRAFT || phase === LEAGUE_PHASE.DRAFTING) {
          status.draft = {
            date: league.draft_date ?? null,
            timezone: league.draft_timezone ?? null,
            seatsFilled: Number(league.team_count),
            maxTeams: Number(league.max_teams),
          };
        }
        out.set(league.id, { status, statusError: false });
      } catch (error) {
        console.error(`home status: league ${league.id} status failed`, error);
        out.set(league.id, { status: null, statusError: true });
      }
    }
    return out;
  } catch (error) {
    return failAll(error);
  }
}

/**
 * The caller's leagues, one row per league they hold a team in: `leagues.*`
 * plus their team's id, name, avatar and waiver standing, the league's team
 * count, and their role. GET /api/league's own list query, shared so the
 * to-do list reads exactly the rows the league list shows.
 *
 * `is_owner` and `is_commissioner` are the viewer's role on each league,
 * answered here so no card has to rebuild it from `leagues.owner_id` and the
 * signed-in account id (#188). `is_owner` is the creator-alone half, covering
 * the powers leagueRole.service's header keeps owner-shaped (deleting the
 * league, granting or revoking co-commissioners); `is_commissioner` is the
 * half a co-commissioner holds too. Both are per-viewer, evaluated against
 * $1, and this response is the list's only per-viewer channel, so they
 * belong on the row.
 */
async function listMyLeagues(db, userId) {
  const { commissionerPredicate } = require('./leagueRole.service');
  const result = await db.query(
    `SELECT "leagues".*, "teams"."id" AS "my_team_id", "teams"."name" AS "my_team_name",
            "teams"."avatar_url" AS "my_team_avatar_url",
            "teams"."avatar_static_url" AS "my_team_avatar_static_url",
            "teams"."waiver_priority" AS "my_team_waiver_priority",
            "teams"."faab_remaining" AS "my_team_faab_remaining",
            (SELECT COUNT(*)::int FROM "teams" "t" WHERE "t"."league_id" = "leagues"."id") AS "team_count",
            ("leagues"."owner_id" = $1) AS "is_owner",
            ${commissionerPredicate(1)} AS "is_commissioner"
     FROM "leagues"
     JOIN "teams" ON "teams"."league_id" = "leagues"."id"
     WHERE "teams"."owner_id" = $1
     ORDER BY "leagues"."created_at" DESC`,
    [userId]
  );
  return result.rows;
}

/* ------------------------------------------------------------------ *
 * GET /api/user/action-items (Home v2, contract A)                     *
 * ------------------------------------------------------------------ */

const SEVERITY_RANK = { blocking: 0, timed: 1, untimed: 2, info: 3 };
const ACTION_ITEM_CAP = 20;

/**
 * Pure: is this an IANA time zone the runtime knows? The client sends its
 * own (the server never guesses a viewer's calendar). A try/catch on
 * Intl.DateTimeFormat rather than Intl.supportedValuesOf, which omits
 * aliases such as UTC on some runtimes.
 */
function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || tz === '' || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Pure: the calendar date (YYYY-MM-DD) of an instant in a zone. */
function calendarDate(value, tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(value));
}

/**
 * Pure: the response body from every builder's items. Order: blocking,
 * timed, untimed, info; within a tier deadlineAt ascending (no deadline
 * last), then newest first (each builder's internal `createdAt`, stripped
 * here so it never reaches the wire). `counts.total` and `counts.dueToday`
 * (a deadline on today's date in `tz`) are over every item; `items` is
 * capped.
 */
function assembleActionItems({ items, partial, now, tz, cap = ACTION_ITEM_CAP }) {
  const deadline = (i) => (i.deadlineAt == null ? Infinity : timeOf(i.deadlineAt));
  const recency = (i) => (i.createdAt == null ? -Infinity : timeOf(i.createdAt));
  const ordered = [...items].sort((a, b) =>
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    || deadline(a) - deadline(b)
    || recency(b) - recency(a)
    || String(a.id).localeCompare(String(b.id)));
  const today = calendarDate(now, tz);
  return {
    generatedAt: iso(now),
    counts: {
      total: ordered.length,
      dueToday: ordered.filter((i) => i.deadlineAt != null && calendarDate(i.deadlineAt, tz) === today).length,
    },
    partial,
    items: ordered.slice(0, cap).map(({ createdAt, ...wire }) => wire),
  };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Pure: one action item in the wire shape (plus the internal `createdAt`). */
function actionItem({ type, key, league, title, detail = null, severity, deadlineAt = null, cta, progress = null, createdAt = null }) {
  return {
    id: `${type}:${league.id}${key == null ? '' : `:${key}`}`,
    type,
    leagueId: league.id,
    leagueName: league.name,
    title,
    detail,
    severity,
    deadlineAt: iso(deadlineAt),
    cta,
    progress,
    createdAt,
  };
}

/** Pure: the lineup_problem row for a lineup status, or null when it is clean. */
function lineupProblemItem(league, status) {
  if (!status || status.problems.length === 0) return null;
  const empty = status.emptySlots || [];
  let title = 'Fix your lineup before kickoff';
  if (empty.length === 1) title = `Fill your empty ${empty[0]} slot`;
  else if (empty.length > 1) title = `Fill ${empty.length} empty lineup slots`;
  return actionItem({
    type: 'lineup_problem',
    key: `${league.current_season}-${league.current_week}`,
    league,
    title,
    detail: status.problems.join(' · '),
    severity: 'timed',
    deadlineAt: status.nextLockAt,
    cta: { label: 'Fix lineup', to: `/league/${league.id}/lineup` },
  });
}

/** Pure: the picks_open row for a Pick'em week, or null when nothing is left to pick. */
function picksOpenItem(league, status) {
  if (!status || status.missing === 0) return null;
  return actionItem({
    type: 'picks_open',
    key: `${league.current_season}-${league.current_week}`,
    league,
    title: `${plural(status.missing, 'pick')} still open`,
    detail: `${status.made} of ${status.total} made for week ${league.current_week}`,
    severity: 'timed',
    deadlineAt: status.nextLockAt,
    cta: { label: 'Make picks', to: `/league/${league.id}/pickem` },
    progress: { done: status.made, total: status.total },
  });
}

/**
 * The eight builders, each `(ctx) => items[]`. `ctx` carries the caller's
 * league rows, the clock and memoized batched reads, so two builders that
 * share a read (the trade ones) run it once, and a builder that throws only
 * takes its own type down.
 */
const ACTION_ITEM_BUILDERS = {
  // A live draft: every member, pick'em-only leagues have no draft.
  async draft_live({ leagues, now }) {
    return leagues
      .filter((l) => !isPickemOnly(l) && l.draft_status === 'active')
      .map((league) => actionItem({
        type: 'draft_live',
        league,
        title: 'Your draft is live',
        detail: 'Head to the draft room so you are ready when you are on the clock',
        severity: 'blocking',
        deadlineAt: now,
        cta: { label: 'Join draft', to: `/league/${league.id}/draft` },
      }));
  },

  // The same lineupStatus the league card shows (best ball: IR problems only).
  async lineup_problem(ctx) {
    const fantasy = ctx.leagues.filter((l) => fantasyWeekApplies(l));
    const statuses = await ctx.once('lineups', () => loadLineupStatuses(ctx.db, { userId: ctx.userId, leagues: fantasy, now: ctx.now }));
    return fantasy.map((league) => lineupProblemItem(league, statuses.get(league.id))).filter(Boolean);
  },

  // The same pickemStatus the league card shows, while the season runs.
  async picks_open(ctx) {
    const running = ctx.leagues.filter((l) => deriveLeaguePhase(l) !== LEAGUE_PHASE.COMPLETE);
    const on = await loadPickemLeagueIds(ctx.db, { userId: ctx.userId, leagues: running });
    const leagues = running.filter((l) => on.has(l.id));
    const weeks = await loadPickemWeeks(ctx.db, { userId: ctx.userId, leagues, now: ctx.now });
    return leagues.map((league) => picksOpenItem(league, weeks.get(league.id))).filter(Boolean);
  },

  // An accepted trade in its veto window that the caller may still vote on.
  async trade_review(ctx) {
    const rows = await ctx.once('trades', () => loadActionTrades(ctx));
    const byId = new Map(ctx.leagues.map((l) => [l.id, l]));
    return rows.filter((t) => t.status === 'accepted' && byId.has(t.league_id)).map((trade) => actionItem({
      type: 'trade_review',
      key: trade.id,
      league: byId.get(trade.league_id),
      title: 'A trade in your league is up for review',
      detail: `${trade.proposing_team_name} and ${trade.receiving_team_name} · vote before the window closes`,
      severity: 'timed',
      deadlineAt: trade.review_ends_at,
      cta: { label: 'Review trade', to: `/league/${trade.league_id}/trades` },
      createdAt: trade.created_at,
    }));
  },

  // Open seats before the draft, for the league's commissioners.
  async seats_open({ leagues }) {
    return leagues
      .filter((l) => l.is_commissioner && deriveLeaguePhase(l) === LEAGUE_PHASE.PRE_DRAFT
        && l.draft_date != null && Number(l.team_count) < Number(l.max_teams))
      .map((league) => {
        const open = Number(league.max_teams) - Number(league.team_count);
        return actionItem({
          type: 'seats_open',
          league,
          title: `${plural(open, 'open seat')} before the draft`,
          detail: `${league.team_count} of ${league.max_teams} teams have joined`,
          severity: 'timed',
          deadlineAt: league.draft_date,
          cta: { label: 'Invite managers', to: `/league/${league.id}` },
          progress: { done: Number(league.team_count), total: Number(league.max_teams) },
        });
      });
  },

  // A pending offer to the caller's team. Offers never expire (trades has
  // no expiry column), so they are untimed and sort newest first.
  async trade_offer(ctx) {
    const rows = await ctx.once('trades', () => loadActionTrades(ctx));
    const byId = new Map(ctx.leagues.map((l) => [l.id, l]));
    return rows.filter((t) => t.status === 'pending' && byId.has(t.league_id)).map((trade) => actionItem({
      type: 'trade_offer',
      key: trade.id,
      league: byId.get(trade.league_id),
      title: `Trade offer from ${trade.proposing_team_name}`,
      detail: 'Accept, counter or decline',
      severity: 'untimed',
      cta: { label: 'Review offer', to: `/league/${trade.league_id}/trades` },
      createdAt: trade.created_at,
    }));
  },

  // Pending join requests, for commissioners of leagues with join approval
  // (discovery.service listJoinRequests' queue, counted for every such
  // league in one read).
  async join_requests(ctx) {
    const run = ctx.leagues.filter((l) => l.is_commissioner && l.join_approval);
    if (run.length === 0) return [];
    const { commissionerPredicate } = require('./leagueRole.service');
    const result = await ctx.db.query(
      `SELECT "join_requests"."league_id", COUNT(*)::int AS "pending",
              MAX("join_requests"."created_at") AS "newest_at",
              array_agg("join_requests"."team_name" ORDER BY "join_requests"."created_at") AS "team_names"
       FROM "join_requests"
       JOIN "leagues" ON "leagues"."id" = "join_requests"."league_id"
       WHERE "join_requests"."league_id" = ANY($2) AND "join_requests"."status" = 'pending'
         AND "leagues"."join_approval" = true AND ${commissionerPredicate(1)}
       GROUP BY "join_requests"."league_id"`,
      [ctx.userId, run.map((l) => l.id)]
    );
    const byId = new Map(run.map((l) => [l.id, l]));
    return result.rows.filter((row) => byId.has(row.league_id) && row.pending > 0).map((row) => actionItem({
      type: 'join_requests',
      league: byId.get(row.league_id),
      title: `${plural(row.pending, 'join request')} waiting`,
      detail: (row.team_names || []).slice(0, 3).join(' · ') || null,
      severity: 'untimed',
      cta: { label: 'Review requests', to: `/league/${row.league_id}` },
      createdAt: row.newest_at,
    }));
  },

  // The caller's pending waiver claims, by the earliest Clear time
  // (waivers.router's clear_at, falling back to the post-draft blanket
  // window the way waiver processing does).
  async waiver_claims(ctx) {
    const fantasy = ctx.leagues.filter((l) => !isPickemOnly(l));
    if (fantasy.length === 0) return [];
    const result = await ctx.db.query(
      `SELECT "waiver_claims"."league_id", COUNT(*)::int AS "pending",
              MIN(COALESCE("waiver_players"."available_at", "leagues"."waivers_clear_at")) AS "next_clear_at",
              MAX("waiver_claims"."created_at") AS "newest_at"
       FROM "waiver_claims"
       JOIN "teams" ON "teams"."id" = "waiver_claims"."team_id"
       JOIN "leagues" ON "leagues"."id" = "waiver_claims"."league_id"
       LEFT JOIN "waiver_players" ON "waiver_players"."league_id" = "waiver_claims"."league_id"
         AND "waiver_players"."player_id" = "waiver_claims"."player_id"
       WHERE "teams"."owner_id" = $1 AND "waiver_claims"."league_id" = ANY($2)
         AND "waiver_claims"."status" = 'pending'
       GROUP BY "waiver_claims"."league_id"`,
      [ctx.userId, fantasy.map((l) => l.id)]
    );
    const byId = new Map(fantasy.map((l) => [l.id, l]));
    return result.rows.filter((row) => byId.has(row.league_id) && row.pending > 0).map((row) => actionItem({
      type: 'waiver_claims',
      league: byId.get(row.league_id),
      title: `${plural(row.pending, 'waiver claim')} pending`,
      detail: 'Claims process at their clear time',
      severity: 'info',
      deadlineAt: row.next_clear_at,
      cta: { label: 'View claims', to: `/league/${row.league_id}/waivers` },
      createdAt: row.newest_at,
    }));
  },
};

/**
 * The trades the caller has something to do about, in one read for both
 * trade builders: pending offers TO their team, and accepted trades in a
 * veto window (leagues.trade_veto_votes > 0, review_ends_at still ahead)
 * that their team is not party to and has not voted on (trade_votes).
 */
async function loadActionTrades(ctx) {
  const fantasy = ctx.leagues.filter((l) => !isPickemOnly(l));
  if (fantasy.length === 0) return [];
  const result = await ctx.db.query(
    `SELECT "trades"."id", "trades"."league_id", "trades"."status", "trades"."review_ends_at",
            "trades"."created_at",
            proposing."name" AS "proposing_team_name", receiving."name" AS "receiving_team_name"
     FROM "trades"
     JOIN "teams" "mine" ON "mine"."league_id" = "trades"."league_id" AND "mine"."owner_id" = $1
     JOIN "leagues" ON "leagues"."id" = "trades"."league_id"
     JOIN "teams" proposing ON proposing."id" = "trades"."proposing_team_id"
     JOIN "teams" receiving ON receiving."id" = "trades"."receiving_team_id"
     WHERE "trades"."league_id" = ANY($2)
       AND (("trades"."status" = 'pending' AND "trades"."receiving_team_id" = "mine"."id")
         OR ("trades"."status" = 'accepted' AND "leagues"."trade_veto_votes" > 0
             AND "trades"."review_ends_at" > $3
             AND "mine"."id" NOT IN ("trades"."proposing_team_id", "trades"."receiving_team_id")
             AND NOT EXISTS (SELECT 1 FROM "trade_votes"
                             WHERE "trade_votes"."trade_id" = "trades"."id"
                               AND "trade_votes"."team_id" = "mine"."id")))`,
    [ctx.userId, fantasy.map((l) => l.id), ctx.now]
  );
  return result.rows;
}

/**
 * GET /api/user/action-items: every builder run in parallel over the
 * caller's leagues; a builder that throws is logged with its type name and
 * listed in `partial`, and the rest still return. `tz` must already be
 * validated (isValidTimeZone).
 */
async function actionItems(db, { userId, now, tz }) {
  const leagues = await listMyLeagues(db, userId);
  const memo = new Map();
  const ctx = {
    db,
    userId,
    now,
    leagues,
    once(key, load) {
      if (!memo.has(key)) memo.set(key, load());
      return memo.get(key);
    },
  };
  const partial = [];
  const items = [];
  const types = Object.keys(ACTION_ITEM_BUILDERS);
  const results = await Promise.all(types.map((type) => settle(ACTION_ITEM_BUILDERS[type](ctx))));
  results.forEach((result, index) => {
    if (result.ok) items.push(...result.value);
    else {
      console.error(`action items: ${types[index]} builder failed`, result.error);
      partial.push(types[index]);
    }
  });
  return assembleActionItems({ items, partial, now, tz });
}

module.exports = {
  listMyLeagues,
  isValidTimeZone,
  assembleActionItems,
  actionItems,
  ACTION_ITEM_BUILDERS,
  lineupProblems,
  lineupEntryFromRow,
  leagueLineupProblems,
  openGameKeys,
  picksMadeByUser,
  missingPicks,
  lineupStatus,
  pickemStatus,
  matchupSummary,
  fantasyWeekApplies,
  loadLineupStatuses,
  loadPickemLeagueIds,
  loadPickemWeeks,
  leagueStatuses,
};
