const pool = require('../modules/pool');
const { upcomingNflSeason } = require('./nflSeason.service');
const { REG_SEASON_WEEKS, getSeasonSlate } = require('./pickem.service');
const { normalizeNflTeam } = require('./nflTeam');
const waiverBoards = require('./waiverBoards');
const projectionService = require('./projection.service');
const { poolPointsMap } = require('./poolProjection');
const { unavailableFor } = require('./unavailable');

/**
 * The public Waiver Wire page's "Week N Waiver Targets" (#1829, spec #1825):
 * the week's editorial board, filtered by Ownership, or (#1830) a computed list
 * when no board exists. Global NFL data only, like the rest of the public
 * layer: no league or user table is read.
 */

// A board entry is served only while its latest Ownership is BELOW this
// percentage. The column is written once, ahead of the week, and Ownership
// moves after that (a pick can be picked up widely, or turn out to be a weekly
// starter in most public leagues). A player rostered in half or more of public
// leagues is not a realistic add for most readers, so a column pick can be
// hidden here on purpose: the page shows only names a reader can plausibly
// claim. Strictly less than, so a player at exactly 50% is dropped.
const OWNERSHIP_CUTOFF_PERCENT = 50;

// The newest Ownership snapshot may be at most this many days old. Older, and the
// feed is stale: percentages are no longer trusted to filter on (#1831).
const OWNERSHIP_STALE_AFTER_DAYS = 3;

const MAX_TARGETS = 8;

// The computed fallback (#1830): only these Positions, at most this many of
// each, so eight slots cannot all go to one Position.
const COMPUTED_POSITIONS = ['QB', 'RB', 'WR', 'TE'];
const MAX_PER_POSITION = 2;
// A player must have recorded stats in one of this many latest completed weeks.
const RECENT_STAT_WEEKS = 2;
// How many of the top-projected players the fallback reads at all. Every filter
// only removes players, so a wide window keeps the 8 slots fillable while the
// candidate read stays bounded.
const CANDIDATE_WINDOW = 400;
// The Weekly run (Position-baseline and Unavailable verdicts) is read for this
// many ranked survivors at a time, so the engine only ever looks at players the
// list can plausibly reach.
const VERDICT_BATCH = 24;

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

// The candidate facts in one read. `has_recent_stats` is a fact selected, not a
// filter, so the rule that a player with no recent stats is dropped lives in
// one place (`computedCandidatesFrom`) next to the others.
const COMPUTED_CANDIDATES_SQL = `
  SELECT "p"."id", "p"."name", "p"."position", "p"."nfl_team", "p"."photo_url", "p"."injury_status",
         EXISTS (
           SELECT 1 FROM "player_stats" "s"
            WHERE "s"."player_id" = "p"."id" AND "s"."season" = $2 AND "s"."week" = ANY($3::int[])
         ) AS "has_recent_stats"
    FROM "players" "p"
   WHERE "p"."id" = ANY($1::int[])`;

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
 * Ownership for a set of player ids: one identity round trip and one Ownership
 * round trip. Returns `identityIdsById` (each id's same-athlete rows) and
 * `ownershipFor(id)`: the id's own row first, then its identity rows; the first
 * snapshot with a percentage wins (the order playersPage.service
 * ownershipForMany uses). With `withOwnership: false` (a stale feed) only the
 * identity round trip runs and `ownershipFor` finds nothing, so an old
 * percentage is never read, let alone served.
 */
async function loadOwnership(ids, { withOwnership = true } = {}) {
  const identityRes = await pool.query(IDENTITY_SQL, [ids]);
  const identityIdsById = new Map();
  for (const row of identityRes.rows) {
    const requested = Number(row.requested_id);
    if (!identityIdsById.has(requested)) identityIdsById.set(requested, []);
    identityIdsById.get(requested).push(Number(row.identity_id));
  }
  if (!withOwnership) return { identityIdsById, ownershipFor: () => undefined };
  // Ownership is read over every identity id, one round trip, and only for the
  // requested players.
  const ownershipIds = [...new Set([...ids, ...[...identityIdsById.values()].flat()])];
  const ownershipRes = await pool.query(OWNERSHIP_SQL, [ownershipIds]);
  const ownershipById = new Map(ownershipRes.rows.map((row) => [Number(row.player_id), row]));
  const ownershipFor = (playerId) => [playerId, ...(identityIdsById.get(playerId) || [])]
    .map((id) => ownershipById.get(id))
    .find((row) => row && row.percent_owned != null);
  return { identityIdsById, ownershipFor };
}

/** The percentage of an Ownership row when it is strictly under the cutoff, else null. */
function ownershipUnderCutoff(row) {
  if (!row || row.percent_owned == null) return null;
  const percent = Number(row.percent_owned);
  return Number.isFinite(percent) && percent < OWNERSHIP_CUTOFF_PERCENT ? percent : null;
}

/**
 * `{ week, source: 'editorial', ownershipAsOf, targets }` from the waiver week's
 * board. Ownership is read only for the board's players and appears only on the
 * targets that survive the cutoff. On a stale feed (#1831) the cutoff is not
 * applied and no Ownership is read: every target carries `ownership: null` and
 * `ownershipAsOf` is the stale snapshot's date.
 */
async function editorialTargets({ board, games, week, stale = null }) {
  const ids = board.entries.map((entry) => entry.playerId);
  const [{ identityIdsById, ownershipFor }, playersRes] = await Promise.all([
    loadOwnership(ids, { withOwnership: !stale }),
    pool.query(PLAYERS_SQL, [ids]),
  ]);
  const playersById = new Map(playersRes.rows.map((row) => [Number(row.id), row]));

  const targets = [];
  const servedIds = new Set();
  let ownershipAsOf = stale ? stale.newest : null;
  for (const entry of board.entries) {
    const row = ownershipFor(entry.playerId);
    const player = playersById.get(entry.playerId);
    const percent = stale ? null : ownershipUnderCutoff(row);
    if (!player || (!stale && percent == null)) continue;
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
    if (!stale && row.captured_date && (ownershipAsOf === null || row.captured_date > ownershipAsOf)) {
      ownershipAsOf = row.captured_date;
    }
    if (targets.length === MAX_TARGETS) break;
  }
  return { week, source: 'editorial', ownershipAsOf, targets };
}

/**
 * Pure: the candidate rows that pass the facts on the player row itself, each
 * with its Pool projection, best projection first. Drops a Position outside
 * QB/RB/WR/TE, No NFL team, no recorded stats in the recent completed weeks, and
 * anyone Unavailable on his own injury designation (Out, IR). Doubtful is
 * dropped too: `unavailableFor` keeps a Doubtful player startable, but a claim
 * for a player unlikely to play is not a target. Questionable stays.
 */
function computedCandidatesFrom(rows, pointsById) {
  return rows
    .filter((row) => COMPUTED_POSITIONS.includes(row.position))
    .filter((row) => row.nfl_team && row.has_recent_stats)
    .filter((row) => {
      const verdict = unavailableFor({ injuryStatus: row.injury_status, noTeam: !row.nfl_team });
      return verdict.available && verdict.status !== 'D';
    })
    .map((row) => ({ row, points: pointsById.get(Number(row.id)) }))
    .filter(({ points }) => points != null)
    .sort((a, b) => b.points - a.points || Number(a.row.id) - Number(b.row.id));
}

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * `{ week, source: 'computed', ownershipAsOf, targets }` for a week with no
 * board (#1830): the highest projected players under the Ownership cutoff, at
 * most MAX_PER_POSITION per Position and MAX_TARGETS in all. Ranked by this
 * week's Pool projection, never season totals. A computed target carries the
 * projection in place of a bid range and reason.
 */
async function computedTargets({ season, games, week }) {
  const result = (targets, ownershipAsOf = null) => ({ week, source: 'computed', ownershipAsOf, targets });
  const recentWeeks = Array.from({ length: RECENT_STAT_WEEKS }, (_, i) => week - 1 - i).filter((w) => w >= 1);
  if (season == null || recentWeeks.length === 0) return result([]);

  const pointsById = poolPointsMap(await projectionService.getWeekProjections({ season, week }));
  const window = [...pointsById]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, CANDIDATE_WINDOW)
    .map(([id]) => id);
  if (window.length === 0) return result([]);

  const playersRes = await pool.query(COMPUTED_CANDIDATES_SQL, [window, season, recentWeeks]);
  const candidates = computedCandidatesFrom(playersRes.rows, pointsById);
  if (candidates.length === 0) return result([]);

  const { identityIdsById, ownershipFor } = await loadOwnership(candidates.map(({ row }) => Number(row.id)));
  const survivors = [];
  for (const candidate of candidates) {
    const ownershipRow = ownershipFor(Number(candidate.row.id));
    const percent = ownershipUnderCutoff(ownershipRow);
    if (percent != null) survivors.push({ ...candidate, percent, capturedDate: ownershipRow.captured_date });
  }

  const targets = [];
  const perPosition = new Map();
  const servedIds = new Set();
  let ownershipAsOf = null;
  const isFull = (position) => (perPosition.get(position) || 0) >= MAX_PER_POSITION;
  for (let cursor = 0; cursor < survivors.length && targets.length < MAX_TARGETS;) {
    // The next ranked survivors whose Position still has a slot. The Weekly run
    // (Position-baseline and Unavailable verdicts) is read for these alone.
    const batch = [];
    while (cursor < survivors.length && batch.length < VERDICT_BATCH) {
      const next = survivors[cursor++];
      if (!isFull(next.row.position)) batch.push(next);
    }
    if (batch.length === 0) break;
    const weekly = await projectionService.getWeeklyProjections({
      season, week, playerIds: batch.map(({ row }) => Number(row.id)),
    });
    for (const { row, points, percent, capturedDate } of batch) {
      const id = Number(row.id);
      if (targets.length === MAX_TARGETS) break;
      if (isFull(row.position)) continue;
      // Unavailable, or a number that is not his own evidence (Position-baseline,
      // Backup quarterback): the Start verdict's two refusals, as the Upgrade's.
      const verdict = weekly.startVerdictFor(id);
      if (verdict.outcome === 'unavailable' || !verdict.numberTrusted) continue;
      // Two rows of one athlete would resolve to one snapshot; serve him once.
      const athleteIds = [id, ...(identityIdsById.get(id) || [])];
      if (athleteIds.some((known) => servedIds.has(known))) continue;
      athleteIds.forEach((known) => servedIds.add(known));
      perPosition.set(row.position, (perPosition.get(row.position) || 0) + 1);
      targets.push({
        playerId: id,
        name: row.name,
        position: row.position,
        nflTeam: row.nfl_team,
        photoUrl: row.photo_url || null,
        opponent: opponentOf(games, week, row.nfl_team),
        ownership: percent,
        projection: round1(points),
      });
      if (capturedDate && (ownershipAsOf === null || capturedDate > ownershipAsOf)) ownershipAsOf = capturedDate;
    }
  }
  return result(targets, ownershipAsOf);
}

// The newest Ownership snapshot across the whole feed, with its age in days
// counted by the database from CURRENT_DATE (the same clock the season read
// uses). `captured_date` is cast to text for the same reason as above. A feed
// with no snapshot at all yields one row of nulls.
const NEWEST_SNAPSHOT_SQL = `
  SELECT MAX("captured_date")::text AS "newest",
         (CURRENT_DATE - MAX("captured_date"))::int AS "age_days"
    FROM "player_ownership"`;

/**
 * `{ newest, ageDays }` when the newest Ownership snapshot is older than
 * OWNERSHIP_STALE_AFTER_DAYS (#1831), else null. Exactly that many days old is
 * still fresh. `captured_date` is the sync node's calendar day and CURRENT_DATE
 * the database session's (UTC), so the age can read one day high near midnight;
 * that only ever errs toward stale, which withholds percentages rather than
 * serving old ones. An empty feed is not "stale": there is no snapshot date to report
 * and the cutoff keeps its existing behavior.
 */
async function staleSnapshot() {
  const { rows } = await pool.query(NEWEST_SNAPSHOT_SQL);
  const row = rows[0];
  if (!row || row.newest == null || row.age_days == null) return null;
  const ageDays = Number(row.age_days);
  return ageDays > OWNERSHIP_STALE_AFTER_DAYS ? { newest: row.newest, ageDays } : null;
}

/**
 * The public Waiver Targets payload. A board for the waiver week always wins
 * (`source: 'editorial'`); a week with none falls back to the computed list
 * (`source: 'computed'`). When the Ownership feed is stale (#1831) the board is
 * served without the cutoff and the computed list is not attempted: no board
 * then means no targets.
 */
async function getWaiverTargets() {
  const season = await upcomingNflSeason();
  const games = season == null ? [] : await getSeasonSlate({ season });
  const week = deriveWaiverWeek(games);
  const stale = await staleSnapshot();

  const board = season == null ? null : waiverBoards.getBoard(season, week);
  if (board && board.entries.length > 0) return editorialTargets({ board, games, week, stale });
  if (stale) return { week, source: 'computed', ownershipAsOf: stale.newest, targets: [] };
  return computedTargets({ season, games, week });
}

module.exports = {
  OWNERSHIP_CUTOFF_PERCENT,
  OWNERSHIP_STALE_AFTER_DAYS,
  MAX_TARGETS,
  MAX_PER_POSITION,
  deriveWaiverWeek,
  getWaiverTargets,
};
