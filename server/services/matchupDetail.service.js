const pool = require('../modules/pool');
const clock = require('../modules/clock');
const projectionService = require('./projection.service');
const scoringRules = require('./scoringRules');
const lineupService = require('./lineup.service');
const decisionService = require('./decision.service');
const lineupOverrideService = require('./lineupOverride.service');
const { countedRoster } = require('./countedRoster.service');
const { decorateMatchups } = require('./expectedFinal.service');
const { normalizeNflTeam } = require('./nflTeam');

/**
 * `GET /api/league/:id/matchups/:matchupId`'s read, moved out of the route
 * (#2231): both starting lineups with per-player points under the league's
 * scoring rules, the decorated status and expected finals, the viewer's live
 * what-if and each side's called shot. The route authenticates, checks
 * membership, connects `client`, calls this and maps the result: `null` is
 * a matchup that is not in the league (404). A live week BEGINs and COMMITs on
 * `client` (materializeLineup's copy-forward must not be observed
 * half-written); a settled week opens no transaction (#978). A throw between
 * the BEGIN and the COMMIT rolls back here and rethrows, so the client never
 * leaves this module with an open transaction (#839); the route's ROLLBACK
 * stays as a backstop.
 *
 * The dependencies the route suites stub with t.mock.method are called
 * through their module objects (`lineupService.materializeLineup`, never a
 * destructure at load), so a stub installed after this file loads still takes.
 */
async function getMatchupDetail({
  leagueId, matchupId, viewerUserId, client,
}) {
  const matchupResult = await client.query(
    `SELECT "matchups".*,
            home."name" AS "home_team_name", away."name" AS "away_team_name",
            home."owner_id" AS "home_owner_id", away."owner_id" AS "away_owner_id",
            home."avatar_url" AS "home_team_avatar_url", away."avatar_url" AS "away_team_avatar_url",
            home."avatar_static_url" AS "home_team_avatar_static_url",
            away."avatar_static_url" AS "away_team_avatar_static_url"
     FROM "matchups"
     JOIN "teams" home ON home."id" = "matchups"."home_team_id"
     JOIN "teams" away ON away."id" = "matchups"."away_team_id"
     WHERE "matchups"."id" = $1 AND "matchups"."league_id" = $2`,
    [matchupId, leagueId]
  );
  const matchup = matchupResult.rows[0];
  if (!matchup) return null;

  const leagueResult = await client.query(`SELECT * FROM "leagues" WHERE "id" = $1`, [leagueId]);
  const leagueRow = leagueResult.rows[0];
  const rules = scoringRules.rulesForLeague(leagueRow);

  // This week's real-game opponents, for the cutscene's chasing defender.
  const scheduleRows = await client.query(
    `SELECT "nfl_team", "opponent" FROM "nfl_games" WHERE "season" = $1 AND "week" = $2`,
    [matchup.season, matchup.week]
  );
  // Keyed by normalizeNflTeam(row.nfl_team), NOT the raw column: a DEF
  // unit's players.nfl_team is a full team name (syncTeamDefenses), while
  // nfl_games.nfl_team is Tank01's raw abbreviation. The lookup below
  // normalizes the same way, so both sides of this JS-side comparison agree
  // (#425, same pattern as #423 in decision.service). The VALUE is folded
  // too (#1136): a starter row's opponent is a Team code once it leaves the
  // server (CONTEXT.md, Team code), never nfl_games's own Tank01 spelling -
  // a raw WSH beside a folded WAS on the same starter row is exactly the
  // bug this closes.
  const opponentByTeam = new Map(
    scheduleRows.rows.map((r) => [normalizeNflTeam(r.nfl_team), normalizeNflTeam(r.opponent)])
  );

  // A SETTLED matchup is read AS PLAYED, never through the current roster
  // (CONTEXT.md, Settle pass): the score printed beside these lists was
  // computed over the as-played population, so joining team_players here
  // would drop a starter who played and was dropped afterwards while his
  // points stayed in the total, and would add a player acquired after his
  // own kickoff to a week he did not play (#976). The matchup's own `final`
  // flag is the settled test, the same fact the settle pass switches on;
  // isFinalWeekForTeam would ask it again with an extra query.
  const asPlayed = matchup.final === true;
  // A settled week's materialization is a no-op (its own finality guard
  // returns immediately) and the reads that follow write nothing, so a
  // settled request buys no transaction: no BEGIN, no finality probes to
  // wrap, no COMMIT (#978). The live path is unchanged - it still needs the
  // transaction, since materializeLineup's copy-forward insert loop must
  // not be observed half-written.
  if (!asPlayed) await client.query('BEGIN');
  // One schedule read for the request rather than one per lineup read: the
  // settled path asks four times (bench and starters, home and away).
  const kickoffCache = new Map();
  // The current-roster join, present for a live week and absent for an
  // as-played one. Filtering cannot substitute for removing it: the join is
  // what took the departed player away.
  const rosterJoin = asPlayed ? '' : `JOIN "team_players" ON "team_players"."team_id" = "lineup_entries"."team_id"
         AND "team_players"."player_id" = "lineup_entries"."player_id"`;
  // lineup_entries.player_id rides beside players.id: rowsHeldAsPlayed reads
  // player_id, while the serialized row and the producer join key on id.
  // Standard starters are read without the join (#2388): a starter dropped
  // after his kickoff keeps his spared row (#627), which settle will score, so
  // the live read shows it too, once rowsHeldAsPlayed agrees (#2391). Best ball
  // and the bench keep the join.
  const lineupSql = (slotPredicate, join = rosterJoin) => `SELECT "players"."id", "players"."name", "players"."position",
              "players"."nfl_team", "players"."injury_status", "players"."photo_url",
              "lineup_entries"."player_id",
              ${asPlayed ? 'TRUE' : lineupService.onRosterColumn()} AS "on_roster",
              "lineup_entries"."slot", "player_stats"."stats"
       FROM "lineup_entries"
       ${join}
       JOIN "players" ON "players"."id" = "lineup_entries"."player_id"
       LEFT JOIN "player_stats" ON "player_stats"."player_id" = "lineup_entries"."player_id"
         AND "player_stats"."season" = $2 AND "player_stats"."week" = $3
       WHERE "lineup_entries"."team_id" = $1 AND "lineup_entries"."season" = $2
         AND "lineup_entries"."week" = $3
         AND ${slotPredicate}
       ORDER BY "lineup_entries"."slot", "players"."name"`;
  const teamLineup = async (teamId) => {
    // Skipped on the settled path: materializeLineup's own finality guard
    // would return immediately anyway, but this ticket's point is that a
    // settled request never opens the transaction that call would run
    // inside, so it must not be called at all (#978).
    if (!asPlayed) {
      await lineupService.materializeLineup(client, {
        leagueId, teamId, season: matchup.season, week: matchup.week, league: leagueRow,
      });
    }
    const lineupRows = await client.query(
      lineupSql('"lineup_entries"."slot" = $4'),
      [teamId, matchup.season, matchup.week, 'BENCH']
    );
    const starterRows = await client.query(
      lineupSql(`"lineup_entries"."slot" NOT IN ('BENCH', 'IR')`, leagueRow.best_ball ? rosterJoin : ''),
      [teamId, matchup.season, matchup.week]
    );
    // Fatal, like the two reads it filters. A settled page that fell back to
    // the current roster when this read failed would be this defect again,
    // wearing a `try`.
    const held = (rows) => lineupService.rowsHeldAsPlayed(client, {
      league: leagueRow, teamId, season: matchup.season, week: matchup.week, rows, kickoffCache,
    });
    // A live standard starters read carries off-roster rows (a spared starter,
    // #627); only those go through the settle filter, so live matches settle (#2391).
    const liveStarters = async (rows) => (leagueRow.best_ball ? rows : lineupService.liveStartersHeld(client, {
      league: leagueRow, teamId, season: matchup.season, week: matchup.week, rows, kickoffCache,
    }));
    return {
      starterRows: asPlayed ? await held(starterRows.rows) : await liveStarters(starterRows.rows),
      benchRows: asPlayed ? await held(lineupRows.rows) : lineupRows.rows,
    };
  };
  let homeRaw;
  let awayRaw;
  try {
    homeRaw = await teamLineup(matchup.home_team_id);
    awayRaw = await teamLineup(matchup.away_team_id);
    if (!asPlayed) await client.query('COMMIT');
  } catch (error) {
    if (!asPlayed) await client.query('ROLLBACK').catch(() => {});
    throw error;
  }

  // The NFL games either roster plays in this week (#884). The view joins
  // through lineup_entries, which the transaction above just materialized
  // for both sides, so the read follows the COMMIT and never finds an
  // empty week by accident; it reads on the pool, since it is not part of
  // that transaction. One row per rostered player and game (two
  // Chiefs on one roster are two rows for one game), so de-duplicate and
  // sort for a stable body. Best-effort: a failed read is an empty array,
  // never a failed request; a week before the live engine has written any
  // game rows is empty too, which is what "no games to watch yet" looks like.
  let nflGameIds = [];
  try {
    const gamesResult = await pool.query(
      `SELECT "tank01_game_id" FROM "view_matchup_nfl_games" WHERE "fantasy_matchup_id" = $1`,
      [matchupId]
    );
    nflGameIds = [...new Set(gamesResult.rows.map((r) => r.tank01_game_id))].sort();
  } catch (gamesErr) {
    console.error('matchup nfl games unavailable', gamesErr.message);
  }

  // The one decorator (expectedFinal.service): the matchup's status and each
  // side's per-team result (expected final, players remaining, and EVERY
  // lineup row, starter and bench, priced by the one rule - the weekly
  // projection under this league's scoring with the availability rule) from a
  // single producer read, at this request's instant. So the totals here, the
  // Game Center card and the Lineup page agree, and a bench number is priced
  // exactly like a starter's (#883). Best-effort: a miss leaves projections
  // null, never an error. The decorator is the sole source of the status;
  // if the call itself throws, the status is unknown (null), never a guessed
  // scheduled/final (ADR 0030, F1).
  let decoration = { status: null, home: null, away: null };
  try {
    [decoration] = await decorateMatchups([matchup], { league: leagueRow, now: clock.now() });
  } catch (efErr) {
    console.error('matchup expected finals unavailable', efErr.message);
  }
  matchup.status = decoration.status;
  // The earliest kickoff among either side's starters and when the live score
  // pass last touched the week (#892), the same two facts the list row carries.
  matchup.first_kickoff_at = decoration.firstKickoffAt ?? null;
  matchup.synced_at = decoration.syncedAt ?? null;
  // A row the producer did not price (a settled week, or its read failed) gets
  // its availability from the Weekly projection read directly (ADR 0061): the
  // read answers from facts whether or not pricing succeeded, so there is no
  // hand-built fallback verdict here. Best-effort: with no read there is no
  // verdict, and the row says so (null).
  const pricedIds = new Set(
    [decoration.home, decoration.away]
      .flatMap((team) => (team ? [...team.starters, ...(team.bench || [])] : []))
      .filter((p) => p.availability)
      .map((p) => p.playerId)
  );
  const unpricedIds = [homeRaw, awayRaw]
    .flatMap((raw) => [...raw.starterRows, ...raw.benchRows])
    .map((row) => row.id)
    .filter((id) => !pricedIds.has(id));
  let weekly = null;
  if (unpricedIds.length > 0) {
    try {
      weekly = await projectionService.getWeeklyProjections({
        season: matchup.season, week: matchup.week, league: leagueRow, playerIds: unpricedIds,
      });
    } catch (verdictErr) {
      console.error('matchup availability unavailable', verdictErr.message);
    }
  }
  const verdictAvailability = (row) => {
    if (!weekly) return null;
    const verdict = weekly.startVerdictFor(row.id);
    const available = verdict.outcome !== 'unavailable';
    return { available, reason: available ? null : verdict.reason };
  };
  const toPlayer = (row, priced) => {
    const projected = priced ? priced.projection : null;
    const availability = priced && priced.availability ? priced.availability : verdictAvailability(row);
    return {
      id: row.id,
      name: row.name,
      position: row.position,
      nfl_team: row.nfl_team,
      injury_status: row.injury_status,
      slot: row.slot,
      // Full stat line for the expandable row; safe to expose (public NFL data).
      stats: row.stats || null,
      points: row.stats ? scoringRules.calculateFantasyPoints(row.stats, rules) : 0,
      // 0 when the player is unavailable (the rule already zeroed it), so the
      // row and the team total agree; null only when nothing was priced.
      projected: Number.isFinite(Number(projected)) && projected != null
        ? Math.round(Number(projected) * 100) / 100
        : null,
      availability,
      opponent: opponentByTeam.get(normalizeNflTeam(row.nfl_team)) || null,
      // The producer's per-starter game classification and the live clock
      // while in progress (#892); null when nothing was priced. The headshot
      // is the players row's ESPN photo_url, null when none resolved.
      game_state: priced ? priced.gameState : null,
      game_clock: priced ? priced.gameClock ?? null : null,
      // The producer's per-starter Expected final (points so far plus the share of his game left times his
      // projection), rounded as the projection is; null when nothing was priced.
      expected_final: priced && priced.expectedFinal != null && Number.isFinite(Number(priced.expectedFinal))
        ? Math.round(Number(priced.expectedFinal) * 100) / 100
        : null,
      photo_url: row.photo_url || null,
    };
  };
  const buildTeam = (raw, team) => {
    const pricedById = new Map(
      [...(team ? team.starters : []), ...(team && team.bench ? team.bench : [])].map((p) => [p.playerId, p])
    );
    // In a best-ball league nobody sets a lineup, so materialization assigns
    // no starting slot and every non-IR row is stored BENCH (CONTEXT.md, Best
    // ball). The stored-slot split below would then match no starter and list
    // every player under Bench (#953).
    // The starters are instead the optimizer's chosen lineup, which the
    // producer summed into this team's Expected final; partition the route's
    // own rows by that chosen set so a listed best-ball starter is exactly a
    // player the total counts. team.starters is that chosen lineup ONLY when
    // the producer had a projection run to choose on (statusReliable): on a
    // projection outage it declines to choose and hands back every candidate
    // with statusReliable false, so gating on it too means an outage falls
    // through to the stored-slot split (today's behaviour, no regression)
    // rather than declaring every player a starter. `team` is also null for a
    // settled matchup (the producer never runs for a final week), so that path
    // keeps the SQL split and never reads the current roster (trap 2 of #953).
    if (leagueRow.best_ball && team && team.statusReliable) {
      const chosen = new Set(team.starters.map((p) => p.playerId));
      const rows = [...raw.starterRows, ...raw.benchRows];
      return {
        starters: rows.filter((row) => chosen.has(row.id)).map((row) => toPlayer(row, pricedById.get(row.id) || null)),
        bench: rows.filter((row) => !chosen.has(row.id)).map((row) => toPlayer(row, pricedById.get(row.id) || null)),
        expectedFinal: team.expectedFinal,
        playersRemaining: team.playersRemaining,
        yetToPlay: team.yetToPlay,
      };
    }
    // A SETTLED best-ball matchup (#1006): `team` is null (decorateMatchups
    // never runs the producer for a final week, #953 trap 2), so the branch
    // above is skipped and the stored-slot split below would find no starter
    // for the same reason it does not for an open week - #953's fix without
    // #1006 was the SAME symptom for every historical best-ball week. There
    // is no producer result to partition by here, but there does not need to
    // be one: `raw`'s rows are already the as-played population (#976,
    // rowsHeldAsPlayed), the identical rows and identical ACTUAL points the
    // settle pass fed its own `optimalLineup` call (scoring.service's
    // best-ball branch), so recomputing that same pure function over them
    // reproduces the settled score's own counted set - not a second,
    // possibly-disagreeing idea of who started. This is NOT the outage
    // shortcut #953 forbids: that one needed a live PROJECTION run this
    // request does not have; this one needs only the already-fetched actual
    // stats, so it never reads the current roster and never calls the
    // producer (trap 2 stays satisfied, and the settled fixture's missing
    // producer-read handler stays unregistered).
    if (leagueRow.best_ball && asPlayed) {
      const rows = [...raw.starterRows, ...raw.benchRows];
      // #1038: rows.id and rows.player_id are the same value on every row
      // that reaches this branch (lineupSql joins players.id to
      // lineup_entries.player_id at equality), so countedRoster's
      // player_id-keyed optimalStarters can be matched back against these
      // rows' `id` without an adapter.
      const { optimalStarters } = countedRoster({
        rows,
        league: leagueRow,
        price: (stats) => (stats ? scoringRules.calculateFantasyPoints(stats, rules) : 0),
      });
      const chosen = new Set(optimalStarters.map((p) => p.playerId));
      return {
        starters: rows.filter((row) => chosen.has(row.id)).map((row) => toPlayer(row, pricedById.get(row.id) || null)),
        bench: rows.filter((row) => !chosen.has(row.id)).map((row) => toPlayer(row, pricedById.get(row.id) || null)),
        expectedFinal: team ? team.expectedFinal : null,
        playersRemaining: team ? team.playersRemaining : null,
        yetToPlay: team ? team.yetToPlay : null,
      };
    }
    return {
      starters: raw.starterRows.map((row) => toPlayer(row, pricedById.get(row.id) || null)),
      bench: raw.benchRows.map((row) => toPlayer(row, pricedById.get(row.id) || null)),
      expectedFinal: team ? team.expectedFinal : null,
      playersRemaining: team ? team.playersRemaining : null,
      yetToPlay: team ? team.yetToPlay : null,
    };
  };
  const homeTeam = buildTeam(homeRaw, decoration.home);
  const awayTeam = buildTeam(awayRaw, decoration.away);

  // Live bench what-if for the viewer, but only when they own one of the two
  // teams in this matchup. Read-only, best-effort, never fails the request.
  let viewerWhatIf = null;
  let viewerTeamId = null;
  // The two owner ids rode on the raw matchup row only so the viewer's own
  // team could be resolved here; they are account identity and must not ride
  // on the shared matchup object, so strip them from the serialization once
  // viewerTeamId is known - never from the SELECT (#343, #115).
  if (matchup.home_owner_id === viewerUserId) viewerTeamId = matchup.home_team_id;
  else if (matchup.away_owner_id === viewerUserId) viewerTeamId = matchup.away_team_id;
  delete matchup.home_owner_id;
  delete matchup.away_owner_id;
  if (viewerTeamId) {
    try {
      // The route already holds the settled fact on `matchup.final`; passing
      // it as `weekIsFinal` buys liveWhatIf out of its own isWeekFinal COUNT
      // read on a settled request (#978, #1017).
      viewerWhatIf = await decisionService.liveWhatIf({
        leagueId, teamId: viewerTeamId, season: matchup.season, week: matchup.week, weekIsFinal: asPlayed,
      });
    } catch (whatIfErr) {
      console.error('live what-if unavailable', whatIfErr.message);
    }
  }

  // Each team's called shot, once both of its players have locked (#1857, ADR
  // 0054 ruling 7); null before that and in a best-ball league. The service
  // owns the visibility rule and reads called rows only, so an Override is
  // never here. A supplementary read: a failure is no shot, never a failed page.
  const publicShot = async (teamId) => {
    if (leagueRow.best_ball) return null;
    try {
      return await lineupOverrideService.loadPublicCalledShot(pool, {
        league: leagueRow, teamId, season: matchup.season, week: matchup.week, now: clock.now(),
      });
    } catch (shotErr) {
      console.error('matchup called shot unavailable', shotErr.message);
      return null;
    }
  };
  const homeCalledShot = await publicShot(matchup.home_team_id);
  const awayCalledShot = await publicShot(matchup.away_team_id);

  return {
    viewerTeamId: viewerTeamId || null,
    viewerWhatIf,
    matchup,
    nflGameIds,
    home: {
      teamId: matchup.home_team_id,
      name: matchup.home_team_name,
      starters: homeTeam.starters,
      bench: homeTeam.bench,
      expectedFinal: homeTeam.expectedFinal,
      playersRemaining: homeTeam.playersRemaining,
      yetToPlay: homeTeam.yetToPlay,
      calledShot: homeCalledShot,
    },
    away: {
      teamId: matchup.away_team_id,
      name: matchup.away_team_name,
      starters: awayTeam.starters,
      bench: awayTeam.bench,
      expectedFinal: awayTeam.expectedFinal,
      playersRemaining: awayTeam.playersRemaining,
      yetToPlay: awayTeam.yetToPlay,
      calledShot: awayCalledShot,
    },
  };
}

module.exports = { getMatchupDetail };
