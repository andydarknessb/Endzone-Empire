const pool = require('../modules/pool');
const { isPickemOnly, PICKEM_ONLY_MESSAGE } = require('./leagueType');
const { requireMember } = require('./leagueMembership.service');
const { computeByeWeeks } = require('./bye.service');
const { injuryDesignationName, isValidStash } = require('./irPolicy.service');

class LineupError extends Error {
  constructor(statusCode, message, code = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

const BENCH = 'BENCH';
const IR = 'IR';
const BEST_BALL_MANAGED_SLOTS = new Set([BENCH, IR]);

// Group keys usable in a slot's eligiblePositions alongside literal position
// codes (e.g. a "DP" slot's eligiblePositions might be ['DL','LB','DB']) —
// expands to every specific defensive position Tank01 reports in that group.
// Players keep their specific position (e.g. 'CB') for display; slots
// configure eligibility at the group level.
const POSITION_GROUPS = {
  DL: ['DL', 'DE', 'DT', 'NT'],
  LB: ['LB', 'ILB', 'OLB'],
  DB: ['DB', 'CB', 'S', 'FS', 'SS'],
};

const DEFAULT_ROSTER_SLOTS = [
  { key: 'QB', label: 'QB', count: 1, eligiblePositions: ['QB'] },
  { key: 'RB', label: 'RB', count: 2, eligiblePositions: ['RB'] },
  { key: 'WR', label: 'WR', count: 2, eligiblePositions: ['WR'] },
  { key: 'TE', label: 'TE', count: 1, eligiblePositions: ['TE'] },
  { key: 'FLEX', label: 'FLEX', count: 1, eligiblePositions: ['RB', 'WR', 'TE'] },
  { key: 'K', label: 'K', count: 1, eligiblePositions: ['K'] },
  { key: 'DEF', label: 'DEF', count: 1, eligiblePositions: ['DEF'] },
];

/** A slot's eligiblePositions, with any group key (DL/LB/DB) expanded to its member positions. */
function expandEligibility(eligiblePositions) {
  const out = new Set();
  for (const p of eligiblePositions || []) {
    if (POSITION_GROUPS[p]) POSITION_GROUPS[p].forEach((m) => out.add(m));
    else out.add(p);
  }
  return out;
}

/**
 * Pure: may a player of this position sit in this named slot? BENCH/IR take
 * anyone. rosterSlots defaults to the standard 7-slot shape so existing
 * 2-arg call sites (and tests) keep working unchanged against it.
 */
function slotEligible(slotKey, position, rosterSlots = DEFAULT_ROSTER_SLOTS) {
  if (slotKey === BENCH || slotKey === IR) return true;
  const slot = rosterSlots.find((s) => s.key === slotKey);
  if (!slot) return false;
  return expandEligibility(slot.eligiblePositions).has(position);
}

/**
 * Normalize a league row's roster/lineup configuration (jsonb columns arrive
 * as objects from pg, but tolerate strings for safety).
 */
function parseLineupSettings(league) {
  const parse = (value, fallback) => {
    if (value == null) return fallback;
    if (typeof value === 'string') {
      try { return JSON.parse(value); } catch { return fallback; }
    }
    return value;
  };
  return {
    rosterSlots: parse(league.roster_slots, DEFAULT_ROSTER_SLOTS),
    positionCaps: parse(league.position_caps, {}),
    benchSlots: Number.isInteger(league.bench_slots) ? league.bench_slots : 5,
    irSlots: Number.isInteger(league.ir_slots) ? league.ir_slots : 1,
  };
}

/**
 * Pure: validate a full lineup against league settings.
 * entries: [{ playerId, position, slot }]. Returns an array of error strings
 * (empty when valid). Starting slots, BENCH, and IR are all capped — total
 * roster size is enforced as starters + bench + IR by construction.
 */
function validateLineup(entries, { rosterSlots = DEFAULT_ROSTER_SLOTS, benchSlots = 5, irSlots = 1 } = {}) {
  const errors = [];
  const counts = {};
  const slotByKey = new Map(rosterSlots.map((s) => [s.key, s]));
  for (const entry of entries) {
    const slot = entry.slot;
    if (slot !== BENCH && slot !== IR && !slotByKey.has(slot)) {
      errors.push(`unknown slot "${slot}"`);
      continue;
    }
    if (!slotEligible(slot, entry.position, rosterSlots)) {
      errors.push(`a ${entry.position} cannot start at ${slot}`);
      continue;
    }
    counts[slot] = (counts[slot] || 0) + 1;
  }
  for (const [slot, count] of Object.entries(counts)) {
    const max = slot === IR ? irSlots : slot === BENCH ? benchSlots : slotByKey.get(slot).count;
    if (count > max) errors.push(`too many players at ${slot} (${count}/${max})`);
  }
  return errors;
}

function entriesForLineupValidation(entries, league) {
  const lineupEntries = Array.from(entries);
  return league.best_ball
    ? lineupEntries.filter((entry) => entry.slot === IR)
    : lineupEntries;
}

/**
 * Is this (team, week) closed to new lineup rows? True only when the team's
 * OWN matchup for that week is final (#106).
 *
 * Absence of a matchup row is deliberately not finality: a team on a bye, or
 * any week before the schedule exists, has nothing to be final and must keep
 * materializing exactly as before. Another matchup being final says nothing
 * about a team that did not play in it, so the team is matched on either side
 * of its own game rather than on the week as a whole.
 */
async function isFinalWeekForTeam(client, { leagueId, teamId, season, week }) {
  const result = await client.query(
    `SELECT 1 FROM "matchups"
     WHERE "league_id" = $1 AND "season" = $2 AND "week" = $3 AND "final" = true
       AND ("home_team_id" = $4 OR "away_team_id" = $4)
     LIMIT 1`,
    [leagueId, season, week, teamId]
  );
  return result.rows.length > 0;
}

/**
 * Ensure every player currently on the team's roster has a lineup_entries row
 * for (season, week). First touch of a week copies slots forward from the
 * team's most recent earlier week; players without history default to BENCH.
 * Must run inside the caller's transaction (client).
 *
 * A FINAL week is frozen (#106): its rows are the record of the week as
 * played, never a working lineup, so nothing materializes into one. The guard
 * lives here rather than at each caller because a final week must be closed
 * on EVERY path that reaches this function, and because the next caller added
 * must inherit that for free rather than having to remember it. Without it, a
 * player acquired in the routine window between the last whistle and the
 * commissioner's advance gets a row in the finished week and is then paid for
 * it by the next re-score: a stat correction or a manual score call silently
 * rewrites a score that was already settled.
 *
 * This does not change how a live week scores, and it does not cost the
 * acquired player his bench spot: the new current week has no row for him
 * either, so its first touch materializes him onto the bench (#97 / PR #102).
 */
async function materializeLineup(client, { leagueId, teamId, season, week }) {
  if (await isFinalWeekForTeam(client, { leagueId, teamId, season, week })) return;

  const rosterResult = await client.query(
    `SELECT "team_players"."player_id", "players"."position"
     FROM "team_players" JOIN "players" ON "players"."id" = "team_players"."player_id"
     WHERE "team_players"."team_id" = $1`,
    [teamId]
  );
  if (rosterResult.rows.length === 0) return;

  const existing = await client.query(
    `SELECT "player_id" FROM "lineup_entries"
     WHERE "team_id" = $1 AND "season" = $2 AND "week" = $3`,
    [teamId, season, week]
  );
  const have = new Set(existing.rows.map((r) => r.player_id));
  const missing = rosterResult.rows.filter((r) => !have.has(r.player_id));
  if (missing.length === 0) return;

  // Copy-forward source: the team's latest earlier week this season (if any).
  // The commissioner attestation travels with the slot (#100), so an
  // attested stash stays attested across weeks until the manager moves him.
  const prevResult = await client.query(
    `SELECT "player_id", "slot", "ir_attested" FROM "lineup_entries"
     WHERE "team_id" = $1 AND "season" = $2
       AND "week" = (SELECT MAX("week") FROM "lineup_entries"
                     WHERE "team_id" = $1 AND "season" = $2 AND "week" < $3)`,
    [teamId, season, week]
  );
  const prevEntries = new Map(prevResult.rows.map((r) => [r.player_id, r]));

  for (const row of missing) {
    const prev = prevEntries.get(row.player_id);
    await client.query(
      `INSERT INTO "lineup_entries" ("league_id", "team_id", "player_id", "season", "week", "slot", "ir_attested")
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT ("team_id", "season", "week", "player_id") DO NOTHING`,
      [leagueId, teamId, row.player_id, season, week, prev?.slot || BENCH, Boolean(prev?.ir_attested)]
    );
  }
}

/**
 * An acquired player never arrives in the IR slot (#94, user story 13): a
 * player gained by draft pick, waiver, trade, commissioner add or free agency
 * cannot bypass the placement gate. Lineup rows outlive a drop, so without
 * this a re-add would sit straight back in his old stash (his surviving
 * current-week row) or have it revived by `materializeLineup`'s copy-forward
 * on a later week's first touch.
 *
 * Two steps, in this order. First the current week is materialized, so it is
 * a complete week (never a lone row the next copy-forward would read as its
 * source and bench the whole roster by) and the player has a row in it.
 * Then every IR row of his from the current week on is moved to the bench,
 * ending any standing attestation (#100) with it: an acquisition is not the
 * undo that restores one. Only IR rows: a surviving starter row from a week
 * he actually played stays as played, with its points. Earlier weeks are
 * history and stay as they were.
 *
 * `undoDrop` calls this only when the stash it would restore is no longer
 * valid (`undoRestoresStash`); otherwise an undo restores the stash it
 * interrupted, which is what `rosterCapacity`'s `restoredPlayerIds` credits.
 * Must run inside the caller's transaction, after the roster write.
 */
async function benchAcquiredPlayer(client, { league, teamId, playerId }) {
  const { id: leagueId, current_season: season, current_week: week } = league;
  await materializeLineup(client, { leagueId, teamId, season, week });
  await client.query(
    `UPDATE "lineup_entries" SET "slot" = $5, "ir_attested" = false, "updated_at" = now()
     WHERE "team_id" = $1 AND "player_id" = $2 AND "season" = $3 AND "week" >= $4 AND "slot" = $6`,
    [teamId, playerId, season, week, BENCH, IR]
  );
}

/**
 * A lineup entry follows the roster (#197). When a team loses a player - by
 * drop, waiver claim, commissioner drop, trade, undone draft pick or the
 * keeper-pruning season rollover - his entries for that team go with him:
 *
 *   - every FUTURE week, always: he is not on the roster, so the row is noise
 *     that no reader should ever see;
 *   - the CURRENT week, unless his NFL game for it has already kicked off, by
 *     the same predicate the lineup lock uses (`lockedNflTeams`), so no game
 *     row that week means not locked;
 *   - PAST weeks, never: they are the record of the week as played (#106).
 *
 * A surviving current-week row therefore means "he was on this roster at
 * kickoff", which is what every reader of a played week assumes. Deleting it
 * unconditionally would be the same disappearance #190 exists to prevent: a
 * starter dropped on Sunday night would lose his row and with it his points.
 *
 * A week the team's own matchup has already settled is likewise left alone,
 * for the reason #106 gives - its rows are the record, not a working lineup,
 * and a DELETE is a write into it like any other. That only ever bites when
 * the kickoff question cannot answer (no game row for him that week), which
 * is a true bye or an unsynced schedule; the second is the one that would
 * cost real points.
 *
 * Runs inside the caller's transaction, after the roster row is gone.
 */
async function removeLineupEntries(client, { league, teamId, playerId, now = new Date() }) {
  const { id: leagueId, current_season: season, current_week: week } = league;
  const playerResult = await client.query(
    `SELECT "nfl_team" FROM "players" WHERE "id" = $1`,
    [playerId]
  );
  const locked = await lockedNflTeams(client, { season, week, now });
  const removeCurrentWeek = !locked.has(playerResult.rows[0]?.nfl_team)
    && !(await isFinalWeekForTeam(client, { leagueId, teamId, season, week }));
  // One statement either way: the current week is spared by the bound
  // parameter, not by a second query, so there is a single predicate to read
  // and a single one to get wrong.
  const result = await client.query(
    `DELETE FROM "lineup_entries"
     WHERE "team_id" = $1 AND "player_id" = $2 AND "season" = $3
       AND ("week" > $4 OR ("week" = $4 AND $5::boolean))`,
    [teamId, playerId, season, week, removeCurrentWeek]
  );
  return { removedCurrentWeek: removeCurrentWeek, removed: result.rowCount };
}

/**
 * The slot and attestation a player holds on this team in the league's
 * current week right now, or null when he has no row there. A drop reads it
 * before `removeLineupEntries` takes the row away, so the waiver hold can
 * record what the drop interrupted and an undo can replay it (#197).
 */
async function currentWeekEntry(client, { league, teamId, playerId }) {
  const result = await client.query(
    `SELECT "slot", "ir_attested" FROM "lineup_entries"
     WHERE "team_id" = $1 AND "player_id" = $2 AND "season" = $3 AND "week" = $4`,
    [teamId, playerId, league.current_season, league.current_week]
  );
  return result.rows[0] || null;
}

/**
 * Undoing a drop puts the player back in the slot the drop interrupted,
 * recorded on his waiver hold at drop time (#197). The row itself is gone -
 * the drop deleted it - so the undo recreates it rather than finding it.
 *
 * Materialize first, for the same reason `benchAcquiredPlayer` does: the week
 * must be complete before it can be the next copy-forward's source. Then the
 * recorded slot and attestation are written over whatever materialization
 * left him in. A final week is frozen and takes neither (#106).
 *
 * Only `undoDrop` calls this, and only when `undoRestoresStash` says the
 * recorded stash is still valid; every other acquisition benches the player.
 */
async function restoreInterruptedStash(client, { league, teamId, playerId, slot, irAttested }) {
  const { id: leagueId, current_season: season, current_week: week } = league;
  if (await isFinalWeekForTeam(client, { leagueId, teamId, season, week })) return;
  await materializeLineup(client, { leagueId, teamId, season, week });
  await client.query(
    `INSERT INTO "lineup_entries" ("league_id", "team_id", "player_id", "season", "week", "slot", "ir_attested")
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT ("team_id", "season", "week", "player_id")
     DO UPDATE SET "slot" = EXCLUDED."slot", "ir_attested" = EXCLUDED."ir_attested", "updated_at" = now()`,
    [leagueId, teamId, playerId, season, week, slot, Boolean(irAttested)]
  );
}

/**
 * The set of NFL team names whose game for (season, week) has kicked off —
 * players on those teams are locked. Empty schedule means nothing is locked.
 */
async function lockedNflTeams(client, { season, week, now = new Date() }) {
  const result = await client.query(
    `SELECT "nfl_team" FROM "nfl_games"
     WHERE "season" = $1 AND "week" = $2 AND "kickoff_at" <= $3`,
    [season, week, now]
  );
  return new Set(result.rows.map((r) => r.nfl_team));
}

/** Pure: add schedule-derived lock and bye metadata to lineup entries. */
function annotateLineupEntries(entries, { locked, byeByTeam, selectedWeek }) {
  return entries.map((row) => {
    const byeWeek = byeByTeam.get(row.nfl_team) ?? null;
    return {
      ...row,
      bye_week: byeWeek,
      locked: locked.has(row.nfl_team),
      onBye: byeWeek === selectedWeek,
      valid_stash: row.slot === IR && isValidStash(row),
    };
  });
}

async function loadLeagueAndTeam(client, { leagueId, userId, forUpdate = false }) {
  const leagueResult = await client.query(
    `SELECT * FROM "leagues" WHERE "id" = $1`,
    [leagueId]
  );
  const league = leagueResult.rows[0];
  if (!league) throw new LineupError(404, 'league not found');
  const team = await requireMember(client, { leagueId, userId, forUpdate });
  return { league, team };
}

/**
 * Fetch (materializing if needed) the caller's lineup for a week, annotated
 * with per-player locked, bye_week, and onBye metadata.
 */
async function getLineup({ leagueId, userId, week }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { league, team } = await loadLeagueAndTeam(client, { leagueId, userId });
    const season = league.current_season;
    const targetWeek = week || league.current_week;

    await materializeLineup(client, { leagueId, teamId: team.id, season, week: targetWeek });

    const entriesResult = await client.query(
      `SELECT "players"."id", "players"."name", "players"."position", "players"."nfl_team",
              "players"."injury_status", "lineup_entries"."slot", "lineup_entries"."ir_attested"
       FROM "lineup_entries"
       JOIN "team_players" ON "team_players"."team_id" = "lineup_entries"."team_id"
         AND "team_players"."player_id" = "lineup_entries"."player_id"
       JOIN "players" ON "players"."id" = "lineup_entries"."player_id"
       WHERE "lineup_entries"."team_id" = $1 AND "lineup_entries"."season" = $2
         AND "lineup_entries"."week" = $3
       ORDER BY "players"."position", "players"."name"`,
      [team.id, season, targetWeek]
    );

    // scoring.service imports lineup.service, so load these after module
    // initialization to avoid a circular top-level dependency.
    const { projectSeasonPoints, rulesForLeague } = require('./scoring.service');
    const playerIds = entriesResult.rows.map((row) => row.id);
    const seasonByPlayer = new Map();
    if (playerIds.length > 0) {
      const seasonResult = await client.query(
        `SELECT "player_id", "season", "games_played", "stats", "fantasy_points"
         FROM "player_season_stats" WHERE "player_id" = ANY($1)`,
        [playerIds]
      );
      for (const row of seasonResult.rows) {
        if (!seasonByPlayer.has(row.player_id)) seasonByPlayer.set(row.player_id, []);
        seasonByPlayer.get(row.player_id).push(row);
      }
    }
    const projectionRules = rulesForLeague(league);
    for (const entry of entriesResult.rows) {
      const seasonProjection = projectSeasonPoints({
        seasonRows: seasonByPlayer.get(entry.id) || [],
        rules: projectionRules,
        currentSeasonYear: season,
      });
      entry.projected_points = seasonProjection == null
        ? null
        : Math.round((seasonProjection / 17) * 10) / 10;
    }

    const locked = await lockedNflTeams(client, { season, week: targetWeek });
    const byeByTeam = await computeByeWeeks(entriesResult.rows.map((row) => row.nfl_team), season);
    await client.query('COMMIT');

    const settings = parseLineupSettings(league);
    return {
      leagueId: league.id,
      teamId: team.id,
      season,
      week: targetWeek,
      currentWeek: league.current_week,
      rosterSlots: settings.rosterSlots,
      benchSlots: settings.benchSlots,
      irSlots: settings.irSlots,
      entries: annotateLineupEntries(entriesResult.rows, { locked, byeByTeam, selectedWeek: targetWeek }),
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Apply one or more slot moves atomically. The team row is locked so
 * concurrent edits serialize; the FINAL lineup is validated against the
 * league's slot counts. Moves touching a locked player are rejected except
 * when the move takes that player out of IR to resolve an invalid stash.
 */
async function setLineup({ leagueId, userId, week, moves }) {
  if (!Array.isArray(moves) || moves.length === 0) {
    throw new LineupError(400, 'moves must be a non-empty array of { playerId, slot }');
  }
  for (const move of moves) {
    if (!Number.isInteger(move.playerId) || typeof move.slot !== 'string') {
      throw new LineupError(400, 'each move needs an integer playerId and a string slot');
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { league, team } = await loadLeagueAndTeam(client, { leagueId, userId, forUpdate: true });
    // No lineups in a pick'em-only league. Message-only like the best-ball
    // refusal below: team.router renders coded errors as { error: code }, which
    // the lineup screen would toast verbatim.
    if (isPickemOnly(league)) throw new LineupError(409, PICKEM_ONLY_MESSAGE);
    const season = league.current_season;
    const targetWeek = week || league.current_week;
    if (targetWeek < league.current_week) {
      throw new LineupError(409, 'cannot edit a past week');
    }

    await materializeLineup(client, { leagueId, teamId: team.id, season, week: targetWeek });

    const entriesResult = await client.query(
      `SELECT "lineup_entries"."player_id", "lineup_entries"."slot",
              "lineup_entries"."ir_attested",
              "players"."name", "players"."position", "players"."nfl_team",
              "players"."injury_status"
       FROM "lineup_entries"
       JOIN "team_players" ON "team_players"."team_id" = "lineup_entries"."team_id"
         AND "team_players"."player_id" = "lineup_entries"."player_id"
       JOIN "players" ON "players"."id" = "lineup_entries"."player_id"
       WHERE "lineup_entries"."team_id" = $1 AND "lineup_entries"."season" = $2
         AND "lineup_entries"."week" = $3
       FOR SHARE OF "players"`,
      [team.id, season, targetWeek]
    );
    const byPlayer = new Map(entriesResult.rows.map((r) => [r.player_id, r]));

    const locked = await lockedNflTeams(client, { season, week: targetWeek });
    const changed = [];
    let resolvesLockedZeroBenchStash = false;
    for (const move of moves) {
      const entry = byPlayer.get(move.playerId);
      if (!entry) throw new LineupError(404, `player ${move.playerId} is not on your roster`);
      if (entry.slot === move.slot) continue;
      if (league.best_ball
          && (!BEST_BALL_MANAGED_SLOTS.has(entry.slot) || !BEST_BALL_MANAGED_SLOTS.has(move.slot))) {
        throw new LineupError(409, 'best-ball managers may move players only between BENCH and IR');
      }
      const resolvesStaleIrStash = !league.best_ball
        && entry.slot === IR
        && move.slot === BENCH
        && !isValidStash(entry);
      resolvesLockedZeroBenchStash ||= resolvesStaleIrStash
        && locked.has(entry.nfl_team)
        && league.bench_slots === 0;
      if (!resolvesStaleIrStash && locked.has(entry.nfl_team)) {
        throw new LineupError(409, 'that player is locked; his game has started', 'LINEUP_LOCKED');
      }
      entry.slot = move.slot;
      // A manager-initiated move ends any commissioner attestation on this
      // player right here (#100), so the save rule below judges the
      // post-move stash by the normal gate - moving an attested player out
      // and back within one save cannot relaunder the override.
      entry.ir_attested = false;
      changed.push(entry);
    }

    const invalidStash = Array.from(byPlayer.values()).find(
      (entry) => entry.slot === IR && !isValidStash(entry)
    );
    if (invalidStash) {
      throw new LineupError(
        400,
        `${invalidStash.name} cannot remain in IR; current injury designation: ${injuryDesignationName(invalidStash.injury_status)}`
      );
    }

    const settings = parseLineupSettings(league);
    const validationSettings = resolvesLockedZeroBenchStash
      ? { ...settings, benchSlots: 1 }
      : settings;
    const entriesToValidate = entriesForLineupValidation(byPlayer.values(), league);
    const errors = validateLineup(
      entriesToValidate.map((e) => ({ playerId: e.player_id, position: e.position, slot: e.slot })),
      validationSettings
    );
    if (errors.length > 0) throw new LineupError(400, errors.join('; '));

    for (const entry of changed) {
      await client.query(
        `UPDATE "lineup_entries" SET "slot" = $1, "ir_attested" = false, "updated_at" = now()
         WHERE "team_id" = $2 AND "season" = $3 AND "week" = $4 AND "player_id" = $5`,
        [entry.slot, team.id, season, targetWeek, entry.player_id]
      );
    }
    // The attestation must not outlive the manager's move in weeks that were
    // materialized ahead of time (#100): the weekly copy-forward would have
    // planted the attested stash there already, and nothing later rewrites
    // it. Earlier weeks keep their history.
    const movedPlayerIds = [...new Set(changed.map((entry) => entry.player_id))];
    if (movedPlayerIds.length > 0) {
      await client.query(
        `UPDATE "lineup_entries" SET "ir_attested" = false, "updated_at" = now()
         WHERE "team_id" = $1 AND "season" = $2 AND "week" > $3
           AND "player_id" = ANY($4::int[]) AND "ir_attested"`,
        [team.id, season, targetWeek, movedPlayerIds]
      );
    }
    await client.query('COMMIT');
    return { leagueId, teamId: team.id, season, week: targetWeek, updated: changed.length };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Pure: the best legal starting lineup for a set of players given per-player
 * points (actual or projected). Slots are filled most-restrictive first
 * (fewest eligible positions), each taking its best remaining players — with
 * the standard slot shapes (dedicated positions + FLEX as a superset) this
 * greedy order is provably optimal.
 *
 * players: [{ playerId, position }]; pointsFor: Map playerId -> points.
 * Returns { starters: [{ playerId, position, slot, points }], total }.
 */
function optimalLineup(players, rosterSlots = DEFAULT_ROSTER_SLOTS, pointsFor = new Map()) {
  const slots = rosterSlots
    .filter((s) => s.count > 0)
    .sort((a, b) => expandEligibility(a.eligiblePositions).size - expandEligibility(b.eligiblePositions).size);
  const available = [...players].sort(
    (a, b) => (Number(pointsFor.get(b.playerId)) || 0) - (Number(pointsFor.get(a.playerId)) || 0)
  );
  const taken = new Set();
  const starters = [];
  let total = 0;
  for (const { key: slot, count } of slots) {
    for (let i = 0; i < count; i++) {
      const pick = available.find(
        (p) => !taken.has(p.playerId) && slotEligible(slot, p.position, rosterSlots)
      );
      if (!pick) continue; // roster can't fill this slot — leave it empty
      taken.add(pick.playerId);
      const points = Number(pointsFor.get(pick.playerId)) || 0;
      starters.push({ playerId: pick.playerId, position: pick.position, slot, points });
      total += points;
    }
  }
  return { starters, total: Math.round(total * 100) / 100 };
}

module.exports = {
  LineupError,
  DEFAULT_ROSTER_SLOTS,
  POSITION_GROUPS,
  slotEligible,
  parseLineupSettings,
  validateLineup,
  entriesForLineupValidation,
  materializeLineup,
  benchAcquiredPlayer,
  removeLineupEntries,
  currentWeekEntry,
  restoreInterruptedStash,
  lockedNflTeams,
  annotateLineupEntries,
  getLineup,
  setLineup,
  optimalLineup,
};
