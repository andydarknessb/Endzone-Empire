const pool = require('../modules/pool');
const { upcomingNflSeason } = require('./nflSeason.service');
const { REG_SEASON_WEEKS, getSeasonSlate } = require('./pickem.service');
const { normalizeNflTeam } = require('./nflTeam');
const waiverBoards = require('./waiverBoards');

/**
 * The public Waiver Wire page's "Week N Waiver Targets" (#1829, spec #1825):
 * the week's editorial board, filtered by Ownership. Global NFL data only, like
 * the rest of the public layer: no league or user table is read.
 */

// A board entry is served only while its latest Ownership is BELOW this
// percentage. The column is written once, ahead of the week, and Ownership
// moves after that (a pick can be picked up widely, or turn out to be a weekly
// starter in most public leagues). A player rostered in half or more of public
// leagues is not a realistic add for most readers, so a column pick can be
// hidden here on purpose: the page shows only names a reader can plausibly
// claim. Strictly less than, so a player at exactly 50% is dropped.
const OWNERSHIP_CUTOFF_PERCENT = 50;

const MAX_TARGETS = 8;

/**
 * Pure: the waiver week of a season's Slate. It is the Slate after the most
 * recent Slate whose every game is final, so it advances only once the whole
 * previous Slate is over: it does not flip during Sunday's games, and it waits
 * for a Tuesday game. Before any Slate is over it is week 1, and it never
 * leaves 1..REG_SEASON_WEEKS.
 *
 * This deliberately reads game finality rather than the calendar
 * (`deriveNflWeek` rolls a week by last kickoff plus a grace period).
 *
 * @param {Array} games `[{ week, status }]` from the season slate
 */
function deriveWaiverWeek(games) {
  const byWeek = new Map();
  for (const game of games || []) {
    const week = Number(game && game.week);
    if (!Number.isInteger(week) || week < 1 || week > REG_SEASON_WEEKS) continue;
    const allFinal = (byWeek.get(week) ?? true) && game.status === 'final';
    byWeek.set(week, allFinal);
  }
  let lastFinished = 0;
  for (const [week, allFinal] of byWeek) {
    if (allFinal && week > lastFinished) lastFinished = week;
  }
  return Math.min(lastFinished + 1, REG_SEASON_WEEKS);
}

/** Pure: the team a club faces in a week's Slate, or null on a bye. */
function opponentOf(games, week, team) {
  const club = normalizeNflTeam(team);
  if (!club) return null;
  for (const game of games) {
    if (game.week !== week) continue;
    const [a, b] = game.teams.map(normalizeNflTeam);
    if (a === club) return b;
    if (b === club) return a;
  }
  return null;
}

// The latest row per player, one round trip. `captured_date` is cast to text so
// a date column never picks up a timezone shift on its way out.
const OWNERSHIP_SQL = `
  SELECT DISTINCT ON ("player_id") "player_id", "percent_owned", "captured_date"::text AS "captured_date"
    FROM "player_ownership"
   WHERE "player_id" = ANY($1::int[])
   ORDER BY "player_id", "captured_date" DESC`;

// The `players` rows that are the same athlete as each requested id: the same
// normalized name, position and team. ESPN Ownership is written only to the row
// whose `external_id` matches, so a board id that points at a duplicate row must
// still find that row's snapshot. This is the bulk form of `loadIdentityIdsFor`
// in playerCard.service.js (not exported there, and that file is outside this
// ticket), so keep the match rule in step with it. The ORDER BY is this
// query's own: it puts the ESPN-matched row (one with an `external_id`) first,
// so which snapshot wins never depends on the plan.
const IDENTITY_SQL = `
  WITH "target" AS (
    SELECT "id" AS "requested_id",
           LOWER(REGEXP_REPLACE(TRIM("name"), '\\s+', ' ', 'g')) AS "name_key",
           "position",
           COALESCE(fn_normalize_nfl_team("nfl_team"), '') AS "team_key"
      FROM "players" WHERE "id" = ANY($1::int[])
  )
  SELECT "target"."requested_id" AS "requested_id", "players"."id" AS "identity_id"
    FROM "target"
    JOIN "players"
      ON LOWER(REGEXP_REPLACE(TRIM("players"."name"), '\\s+', ' ', 'g')) = "target"."name_key"
     AND "players"."position" = "target"."position"
     AND COALESCE(fn_normalize_nfl_team("players"."nfl_team"), '') = "target"."team_key"
   ORDER BY "target"."requested_id", ("players"."external_id" IS NULL), "players"."id"`;

const PLAYERS_SQL = `
  SELECT "id", "name", "position", "nfl_team", "photo_url"
    FROM "players"
   WHERE "id" = ANY($1::int[])`;

function serializeTarget({ entry, player, ownership, opponent }) {
  return {
    playerId: player.id,
    name: player.name,
    position: player.position,
    nflTeam: player.nfl_team,
    photoUrl: player.photo_url || null,
    opponent,
    ownership,
    bidMin: entry.bidMin,
    bidMax: entry.bidMax,
    reason: entry.reason,
  };
}

/**
 * `{ week, source: 'editorial', ownershipAsOf, targets }`. With no board for
 * the waiver week, `targets` is empty. Ownership is read only for the board's
 * players and appears only on the targets that survive the cutoff.
 */
async function getWaiverTargets() {
  const season = await upcomingNflSeason();
  const games = season == null ? [] : await getSeasonSlate({ season });
  const week = deriveWaiverWeek(games);
  const empty = { week, source: 'editorial', ownershipAsOf: null, targets: [] };

  const board = season == null ? null : waiverBoards.getBoard(season, week);
  if (!board || board.entries.length === 0) return empty;

  const ids = board.entries.map((entry) => entry.playerId);
  const [identityRes, playersRes] = await Promise.all([
    pool.query(IDENTITY_SQL, [ids]),
    pool.query(PLAYERS_SQL, [ids]),
  ]);
  const identityIdsById = new Map();
  for (const row of identityRes.rows) {
    const requested = Number(row.requested_id);
    if (!identityIdsById.has(requested)) identityIdsById.set(requested, []);
    identityIdsById.get(requested).push(Number(row.identity_id));
  }
  // Ownership is read over every identity id, one round trip, and only for the
  // board's own players.
  const ownershipIds = [...new Set([...ids, ...[...identityIdsById.values()].flat()])];
  const ownershipRes = await pool.query(OWNERSHIP_SQL, [ownershipIds]);
  const ownershipById = new Map(ownershipRes.rows.map((row) => [Number(row.player_id), row]));
  const playersById = new Map(playersRes.rows.map((row) => [Number(row.id), row]));

  // The board id's own row first, then its identity rows; the first snapshot
  // with a percentage wins (the order playersPage.service ownershipForMany uses).
  const ownershipFor = (playerId) => [playerId, ...(identityIdsById.get(playerId) || [])]
    .map((id) => ownershipById.get(id))
    .find((row) => row && row.percent_owned != null);

  const targets = [];
  const servedIds = new Set();
  let ownershipAsOf = null;
  for (const entry of board.entries) {
    const row = ownershipFor(entry.playerId);
    const player = playersById.get(entry.playerId);
    if (!row || !player || row.percent_owned == null) continue;
    const percent = Number(row.percent_owned);
    if (!Number.isFinite(percent) || !(percent < OWNERSHIP_CUTOFF_PERCENT)) continue;
    // Two board ids that are rows of the same athlete (an editorial slip) would
    // resolve to one snapshot; serve the athlete once, at the earlier entry.
    const athleteIds = [entry.playerId, ...(identityIdsById.get(entry.playerId) || [])];
    if (athleteIds.some((id) => servedIds.has(id))) continue;
    athleteIds.forEach((id) => servedIds.add(id));
    targets.push(serializeTarget({
      entry,
      player,
      ownership: percent,
      opponent: opponentOf(games, week, player.nfl_team),
    }));
    if (row.captured_date && (ownershipAsOf === null || row.captured_date > ownershipAsOf)) {
      ownershipAsOf = row.captured_date;
    }
    if (targets.length === MAX_TARGETS) break;
  }
  return { week, source: 'editorial', ownershipAsOf, targets };
}

module.exports = {
  OWNERSHIP_CUTOFF_PERCENT,
  MAX_TARGETS,
  deriveWaiverWeek,
  getWaiverTargets,
};
