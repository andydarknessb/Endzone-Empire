const pool = require('../modules/pool');
const { withTransaction } = require('../modules/withTransaction');
const { assertFantasyLeagueRow } = require('./leagueType');
const { requireMember } = require('./leagueMembership.service');
const { logTransaction, notify } = require('./activity.service');
const { getDraftRoomBroadcast } = require('../modules/draftRoomBroadcast');
const { rosterCapacity } = require('./irPolicy.service');
const { fantasySeasonLiveWhereSql } = require('./leaguePhase');
const { normalizeNflTeam } = require('./nflTeam');
// Module object, not destructured: the seam tests mock benchAcquiredPlayer.
const lineupService = require('./lineup.service');
// isOnWaivers lives in its own leaf so the roster gate can share it without a
// circular require back into this module (#944; see waiverStatus.js). Kept in
// this module's exports below so existing importers are untouched.
const { isOnWaivers } = require('./waiverStatus');
const { assertRosterWriteAllowed, isLeagueFrozen, ROSTER_GATE } = require('./rosterGate.service');

class WaiverError extends Error {
  constructor(statusCode, message, code) {
    super(message);
    this.statusCode = statusCode;
    if (code) this.code = code;
  }
}

/**
 * Pure: the ONE ordering of due pending claims for a whole league, best first
 * (ADR 0048). Processing walks this list front to back; there is no second
 * ordering.
 * - 'faab': highest bid first, then the keys below.
 * - Waiver priority (lower = better). The order itself is reset to reverse
 *   standings on every week finalize (season.service resetWaiverPriorities); a
 *   winner's move to the back lasts only until that reset.
 * - the claiming team's Claim order (lower = earlier), which ranks a manager's
 *   claims against each other only: it sits below Waiver priority, so it never
 *   lifts a claim over another team's.
 * - created_at, then id.
 * claims: [{ id, team_id, bid, claim_order, created_at }]
 * priorities: Map(team_id -> waiver_priority)
 */
function orderClaims(claims, priorities, waiverType) {
  const byPriority = (a, b) =>
    (priorities.get(a.team_id) || 999) - (priorities.get(b.team_id) || 999) ||
    (a.claim_order || 0) - (b.claim_order || 0) ||
    new Date(a.created_at) - new Date(b.created_at) ||
    a.id - b.id;
  const sorted = [...claims];
  if (waiverType === 'faab') {
    sorted.sort((a, b) => (b.bid || 0) - (a.bid || 0) || byPriority(a, b));
  } else {
    sorted.sort(byPriority);
  }
  return sorted;
}

/**
 * When a player leaves a roster he goes on waivers for the league's waiver
 * period. Runs inside the caller's transaction. `droppedByTeamId` (when the
 * waiver hold originates from a roster drop rather than a waiver-claim swap)
 * records which team can undo it — see `undoDrop` in draft.service.js.
 *
 * `interruptedSlot` / `interruptedIrAttested` record what the drop
 * interrupted: the slot and attestation the player held in the current week
 * at the moment he was dropped (#197). The undo replays that record rather
 * than reading a leftover lineup row, because the drop deletes the row. The
 * hold is the right home for it: it already names the dropping team, it
 * already gates undo, and it is cleared when the hold clears, which is
 * exactly when the undo stops being offered.
 *
 * `availableAt` (#1375, ADR 0043) is an absolute-instant override for a
 * caller that already knows the clear time itself - the kickoff hold job,
 * whose clear is the week's last kickoff plus the waiver period, an instant
 * with no fixed relationship to "now". Left null (every existing caller),
 * the clear is `waiverPeriodHours` from now, exactly as before.
 *
 * ON CONFLICT, only the clear time moves, and only upward: `GREATEST` keeps
 * whichever of the existing row and this write clears later, both
 * directions (#1375 ADR 0043 - a drop's own clear can be later than a
 * kickoff hold's week clear, or the reverse). The dropping team and
 * interrupted-stash columns are never part of the UPDATE, so a conflict
 * never touches them regardless of which caller loses the race: a kickoff
 * hold's null dropping team can never blank a real drop's record, and the
 * columns otherwise remain exactly what the row's first write set them to.
 */
async function placeOnWaivers(client, {
  leagueId,
  playerId,
  waiverPeriodHours,
  availableAt = null,
  droppedByTeamId = null,
  interruptedSlot = null,
  interruptedIrAttested = false,
}) {
  await client.query(
    `INSERT INTO "waiver_players" ("league_id", "player_id", "available_at", "dropped_by_team_id",
                                   "interrupted_slot", "interrupted_ir_attested")
     VALUES ($1, $2, COALESCE($3::timestamptz, now() + make_interval(hours => $4::int)), $5, $6, $7)
     ON CONFLICT ("league_id", "player_id")
     DO UPDATE SET "available_at" = GREATEST("waiver_players"."available_at", EXCLUDED."available_at"),
                   "updated_at" = now()`,
    [leagueId, playerId, availableAt, waiverPeriodHours, droppedByTeamId, interruptedSlot, interruptedIrAttested]
  );
}

/**
 * `placeOnWaivers` plus everything an undo will need: what the dropped
 * player's current-week lineup row held, recorded on the hold before the row
 * is deleted, and the team that may replay it.
 *
 * Named for what it does, which is not the whole drop. The caller still owns
 * the roster row: delete it first, then call this inside the same
 * transaction. Both callers do exactly that.
 *
 * The order is the point, and it is why this is one function rather than
 * three calls repeated at each site: `currentWeekEntry` has to run before
 * `removeLineupEntries` takes the row away, and both have to run before the
 * hold is written, or the hold records nothing and the undo silently
 * benches him (#197).
 *
 * **Two callers, and a third that must not become one.** `draft.service`'s
 * manager drop and `commissioner.service`'s forced drop are both undoable
 * and both belong here. The waiver-claim drop in `processWaivers` below is
 * not: a claim's drop leaves no undo to offer, so it records no interrupted
 * stash and names no dropping team, and it calls `placeOnWaivers` directly.
 * That is a deliberate difference, not an oversight - hence the name. If a
 * fourth drop path appears, the question to answer before reaching for this
 * helper is whether it is undoable; if it is not, it does not want the
 * record and passing it would offer an undo that cannot work.
 */
async function placeOnWaiversUndoable(client, { league, teamId, playerId }) {
  const interrupted = await lineupService.currentWeekEntry(client, { league, teamId, playerId });
  await lineupService.removeLineupEntries(client, { league, teamId, playerId });
  await placeOnWaivers(client, {
    leagueId: league.id,
    playerId,
    waiverPeriodHours: league.waiver_period_hours,
    droppedByTeamId: teamId,
    ...lineupService.interruptedStashFields(interrupted),
  });
}

/**
 * The single player a manager selected from Player Browser to claim. This is
 * intentionally a targeted read rather than a second waiver list: a blanket
 * waiver window applies to every unrostered player and must not turn the
 * Waiver Wire into the entire player catalog.
 */
async function claimTarget({ leagueId, userId, playerId }) {
  const leagueResult = await pool.query(`SELECT * FROM "leagues" WHERE "id" = $1`, [leagueId]);
  const league = leagueResult.rows[0];
  if (!league) throw new WaiverError(404, 'league not found');
  assertFantasyLeagueRow(league);
  // An entry gate: tells the manager before he fills in a claim. The actual
  // award still runs the write-time gate below, in submitClaim/processWaivers;
  // this delegates to the gate's own fail-closed freeze read (#966) so the
  // two cannot drift on what the column means.
  if (isLeagueFrozen(league)) {
    throw new WaiverError(409, 'transactions are locked by the commissioner');
  }

  const team = await requireMember(pool, { leagueId, userId });
  if (team.locked) throw new WaiverError(409, 'your team is locked by the commissioner');

  const playerResult = await pool.query(
    `SELECT "id", "name", "position", "nfl_team" FROM "players" WHERE "id" = $1`,
    [playerId]
  );
  const player = playerResult.rows[0];
  if (!player) throw new WaiverError(404, 'player not found');

  const rostered = await pool.query(
    `SELECT 1 FROM "team_players" WHERE "league_id" = $1 AND "player_id" = $2`,
    [leagueId, playerId]
  );
  if (rostered.rows[0]) throw new WaiverError(409, 'player is already rostered in this league');
  if (!(await isOnWaivers(pool, { league, playerId }))) {
    throw new WaiverError(409, 'player is not on waivers');
  }
  return player;
}

/**
 * Why a claim would overflow the roster, or null when it fits. Shared by
 * submit time and process time so a manager hears "choose a drop" when the
 * claim is built, not days later when it silently fails to execute.
 */
async function capacityFailureReason(client, { league, team, dropPlayerId }) {
  const count = await client.query(
    `SELECT COUNT(*)::int AS n FROM "team_players" WHERE "team_id" = $1`,
    [team.id]
  );
  const effective = count.rows[0].n - (dropPlayerId ? 1 : 0);
  // Roster capacity, not the static roster limit: an eligible IR stash grants
  // a spot, and a dropped player's own stash grants nothing (#97). The claimed
  // player gets no restored credit either - a won claim benches him.
  const capacity = await rosterCapacity(client, {
    league,
    teamId: team.id,
    excludePlayerIds: dropPlayerId ? [dropPlayerId] : [],
  });
  if (effective >= capacity) return `roster capacity of ${capacity} reached`;
  return null;
}

/** Submit a waiver claim (optionally dropping a player, optionally a FAAB bid). */
async function submitClaim({ leagueId, userId, playerId, dropPlayerId, bid = 0 }) {
  // withTransaction owns connect/BEGIN/COMMIT-or-guarded-ROLLBACK and the
  // release rule (ADR 0033). Every refusal throws a WaiverError inside work,
  // which the wrapper rolls back and rethrows untouched, so there is no
  // catch-side mapping to move outward.
  return withTransaction(
    pool,
    async (client) => {
    // The league row lock serialises max(claim_order)+1 per league and matches
    // processWaivers' lock order (league row first, team rows after). Not the
    // team row alone: processWaivers holds the league row then updates team
    // rows, and this insert's foreign key check share-locks the league row, so
    // a team-first lock would invert the order. No advisory lock (#839).
    const leagueResult = await client.query(`SELECT * FROM "leagues" WHERE "id" = $1 FOR UPDATE`, [leagueId]);
    const league = leagueResult.rows[0];
    if (!league) throw new WaiverError(404, 'league not found');
    assertFantasyLeagueRow(league); // no waivers in a pick'em-only league
    // An entry gate (#966): the award itself runs through processWaivers's
    // own write-time gate; this delegates to the gate's fail-closed freeze
    // read so the two cannot drift on what the column means.
    if (isLeagueFrozen(league)) {
      throw new WaiverError(409, 'transactions are locked by the commissioner');
    }

    const team = await requireMember(client, { leagueId, userId });
    if (team.locked) throw new WaiverError(409, 'your team is locked by the commissioner');

    if (league.waiver_type === 'faab') {
      if (!Number.isInteger(bid) || bid < 0) throw new WaiverError(400, 'bid must be a non-negative integer');
      if (bid > team.faab_remaining) {
        throw new WaiverError(409, `bid exceeds your remaining FAAB budget (${team.faab_remaining})`);
      }
    }

    const rostered = await client.query(
      `SELECT 1 FROM "team_players" WHERE "league_id" = $1 AND "player_id" = $2`,
      [leagueId, playerId]
    );
    if (rostered.rows[0]) throw new WaiverError(409, 'player is already rostered in this league');
    if (!(await isOnWaivers(client, { league, playerId }))) {
      throw new WaiverError(409, 'player is not on waivers');
    }

    if (dropPlayerId) {
      const onMyTeam = await client.query(
        `SELECT 1 FROM "team_players" WHERE "team_id" = $1 AND "player_id" = $2`,
        [team.id, dropPlayerId]
      );
      if (!onMyTeam.rows[0]) throw new WaiverError(404, 'drop player is not on your roster');
    }

    const overflow = await capacityFailureReason(client, { league, team, dropPlayerId });
    if (overflow) throw new WaiverError(409, `${overflow}; choose a player to drop`);

    const dupe = await client.query(
      `SELECT 1 FROM "waiver_claims"
       WHERE "team_id" = $1 AND "player_id" = $2 AND "status" = 'pending'`,
      [team.id, playerId]
    );
    if (dupe.rows[0]) throw new WaiverError(409, 'you already have a pending claim on this player');

    // A new claim joins the team's Claim order last, from any surface.
    const nextOrder = await client.query(
      `SELECT COALESCE(MAX("claim_order"), 0) + 1 AS "next" FROM "waiver_claims"
       WHERE "team_id" = $1 AND "status" = 'pending'`,
      [team.id]
    );
    const claimResult = await client.query(
      `INSERT INTO "waiver_claims" ("league_id", "team_id", "player_id", "drop_player_id", "bid", "claim_order")
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [leagueId, team.id, playerId, dropPlayerId || null, league.waiver_type === 'faab' ? bid : 0, nextOrder.rows[0].next]
    );
    return claimResult.rows[0];
    },
    { label: 'waiver-claim' }
  );
}

/** Cancel one of the caller's pending claims. */
async function cancelClaim({ leagueId, userId, claimId }) {
  const result = await pool.query(
    `UPDATE "waiver_claims" SET "status" = 'cancelled', "updated_at" = now()
     FROM "teams"
     WHERE "waiver_claims"."id" = $1 AND "waiver_claims"."status" = 'pending'
       AND "teams"."id" = "waiver_claims"."team_id"
       AND "teams"."league_id" = $2 AND "teams"."owner_id" = $3
     RETURNING "waiver_claims".*`,
    [claimId, leagueId, userId]
  );
  if (!result.rows[0]) throw new WaiverError(404, 'pending claim not found');
  return result.rows[0];
}

/**
 * Set the caller's Claim order (ADR 0048): `claimIds` must be exactly the
 * caller's team's pending claim ids in this league, no more, no fewer, each
 * once; the write is claim_order 1..N in that sequence. Manager-only for their
 * own team (the team is the caller's membership row, never a passed id). Takes
 * the league row lock the claim insert and processWaivers also take, so a
 * reorder cannot interleave with either.
 */
async function reorderClaims({ leagueId, userId, claimIds }) {
  return withTransaction(
    pool,
    async (client) => {
      const leagueResult = await client.query(`SELECT * FROM "leagues" WHERE "id" = $1 FOR UPDATE`, [leagueId]);
      const league = leagueResult.rows[0];
      if (!league) throw new WaiverError(404, 'league not found');
      assertFantasyLeagueRow(league);
      const team = await requireMember(client, { leagueId, userId });

      const pendingResult = await client.query(
        `SELECT "id" FROM "waiver_claims" WHERE "team_id" = $1 AND "status" = 'pending'`,
        [team.id]
      );
      const pending = new Set(pendingResult.rows.map((r) => r.id));
      const given = new Set(claimIds);
      const exact = given.size === claimIds.length && given.size === pending.size
        && claimIds.every((id) => pending.has(id));
      if (!exact) {
        throw new WaiverError(
          409,
          'claimIds must be exactly your pending claims in this league, each once',
          'CLAIM_ORDER_MISMATCH'
        );
      }
      if (claimIds.length > 0) {
        await client.query(
          `UPDATE "waiver_claims" SET "claim_order" = "o"."ord", "updated_at" = now()
           FROM unnest($1::int[], $2::int[]) AS "o"("id", "ord")
           WHERE "waiver_claims"."id" = "o"."id"`,
          [claimIds, claimIds.map((_, i) => i + 1)]
        );
      }
      return { claimIds };
    },
    { label: 'waiver-claim-order' }
  );
}

/**
 * Resolve every DUE pending claim in a league (a claim is due once its
 * player's waiver window has expired). Claims are walked in ONE global order
 * (orderClaims: bid, Waiver priority, Claim order, ...) and each is
 * re-validated at its own turn; a winning claim executes the add (and
 * optional drop) atomically, deducts FAAB, and sends the winner to the back of
 * the priority order. Everything happens inside one transaction with the
 * league row locked, so the scheduler and a manual trigger can't
 * double-process.
 */
/**
 * The post-draft blanket window (leagues.waivers_clear_at) is spent once it
 * has expired and been processed, exactly like an expired waiver_players row.
 * Left in place, an expired window keeps the league in processAllDueWaivers'
 * due list on EVERY scheduler tick for the rest of the season, and every
 * listing re-runs the waiver-results email digest (NanaGoat's 66 copies of one
 * "WON" email, 2026-09-02). Every reader already treats a past window and a
 * NULL one identically (isOnWaivers, the Player Browser's window flag), so
 * NULLing it changes no read model. Guarded on `<= now()` because a
 * commissioner may trigger processing while the window is still open, and an
 * open window must survive that. Runs inside the caller's transaction, after
 * the league row's FOR UPDATE lock.
 */
async function spendExpiredBlanketWindow(client, leagueId) {
  await client.query(
    `UPDATE "leagues" SET "waivers_clear_at" = NULL
     WHERE "id" = $1 AND "waivers_clear_at" <= now()`,
    [leagueId]
  );
}

/**
 * Open the post-draft blanket waiver window: every undrafted player sits on
 * waivers for one waiver period from now (leagues.waivers_clear_at). This is the
 * ONE spelling of that write (#789 ruling 3): column-based, so the interval
 * reads `waiver_period_hours` off the league row itself and binds no hours
 * parameter. Runs inside the caller's transaction (draftCompletion.completeDraft),
 * after the draft_status flip and under the league row's FOR UPDATE lock. The
 * counterpart that spends the window is spendExpiredBlanketWindow above.
 */
async function openPostDraftWaiverWindow(client, { leagueId }) {
  await client.query(
    `UPDATE "leagues" SET "waivers_clear_at" = now() + make_interval(hours => "waiver_period_hours")
     WHERE "id" = $1`,
    [leagueId]
  );
}

/**
 * Seed the Waiver priority order when the draft completes: reverse draft order,
 * so the last pick claims first (CONTEXT.md, Waiver priority). Ranks every team
 * in the league in one statement, the same spelling the waivers migration used
 * for the leagues that existed then; the leagues created since had no seed at
 * all and started the season with NULL priorities, which orderClaims reads as
 * "worst" for everyone and processWaivers then hands out only the back slot.
 * The weekly reset (season.service resetWaiverPriorities) takes over from the
 * first finalized week. Runs inside the caller's transaction
 * (draftCompletion.completeDraft), after the draft_status flip.
 */
async function seedWaiverPriorityFromDraftOrder(client, { leagueId }) {
  await client.query(
    `UPDATE "teams" SET "waiver_priority" = "ranked"."rank", "updated_at" = now()
     FROM (
       SELECT "id", ROW_NUMBER() OVER (ORDER BY "draft_position" DESC NULLS LAST, "id" DESC) AS "rank"
       FROM "teams" WHERE "league_id" = $1
     ) AS "ranked"
     WHERE "teams"."id" = "ranked"."id"`,
    [leagueId]
  );
}

async function processWaivers({ leagueId }) {
  // withTransaction owns connect/BEGIN/COMMIT-or-guarded-ROLLBACK and the
  // release rule (ADR 0033). The no-due-claims branch returns inside work,
  // which COMMITs: it returns AFTER real writes (clearing expired
  // waiver_players and the blanket window), exactly as the hand-rolled early
  // COMMIT did - a committing early return, not a ROLLBACK-before-write, so
  // it is untouched by Ruling 2. Both that branch and the full path broadcast
  // rosterChanged after the commit, identically, so that one post-commit
  // broadcast is hoisted below the call. Refusals (a frozen league from the
  // roster gate) throw and the wrapper rolls back; no catch-side mapping.
  const result = await withTransaction(
    pool,
    async (client) => {
    const leagueResult = await client.query(
      `SELECT * FROM "leagues" WHERE "id" = $1 FOR UPDATE`,
      [leagueId]
    );
    const league = leagueResult.rows[0];
    if (!league) throw new WaiverError(404, 'league not found');

    // Due = the player's individual window expired, or he has no individual
    // window and the post-draft blanket window (if any) has expired.
    const dueResult = await client.query(
      `SELECT "waiver_claims".*
       FROM "waiver_claims"
       LEFT JOIN "waiver_players" ON "waiver_players"."league_id" = "waiver_claims"."league_id"
         AND "waiver_players"."player_id" = "waiver_claims"."player_id"
       WHERE "waiver_claims"."league_id" = $1 AND "waiver_claims"."status" = 'pending'
         AND COALESCE("waiver_players"."available_at",
                      (SELECT "waivers_clear_at" FROM "leagues" WHERE "id" = $1),
                      now()) <= now()
       ORDER BY "waiver_claims"."player_id", "waiver_claims"."id"`,
      [leagueId]
    );
    if (dueResult.rows.length === 0) {
      await client.query(
        `DELETE FROM "waiver_players" WHERE "league_id" = $1 AND "available_at" <= now()`,
        [leagueId]
      );
      await spendExpiredBlanketWindow(client, leagueId);
      // Returning COMMITs these writes (the DELETE and spend above), exactly as
      // the hand-rolled early COMMIT did. The scheduler also reaches this path
      // when an empty blanket window expires: no roster write is needed, but the
      // Player read model changed from waiver-only to free-agent and connected
      // managers must refetch. That broadcast is post-commit work and is hoisted
      // below the wrapper, shared with the full path (it runs in the WORKER, so
      // it rides the one Draft room adapter, #745).
      return { processed: 0, results: [] };
    }

    const teamsResult = await client.query(
      `SELECT "teams".*, "users"."id" AS "user_id" FROM "teams"
       JOIN "users" ON "users"."id" = "teams"."owner_id"
       WHERE "teams"."league_id" = $1`,
      [leagueId]
    );
    const teams = new Map(teamsResult.rows.map((t) => [t.id, t]));
    const priorities = new Map(teamsResult.rows.map((t) => [t.id, t.waiver_priority]));
    const teamCount = teamsResult.rows.length;

    // Every terminal claim status goes through the write-time roster gate
    // (#990). A freeze must stop a claim being permanently invalidated, not
    // only stop it being awarded: `invalid` is terminal and nothing revives
    // it, so a batch in which every due claim independently fails
    // `claimFailureReason` used to destroy those claims inside the very
    // window the league was supposed to be standing still. Gating the helper
    // rather than the one `invalid` call site means a terminal status added
    // later inherits the refusal too. The League row is held FOR UPDATE from
    // the top of this transaction, so the gate's League read is a re-lock of
    // a row we already own and the answer is the same at every point in the
    // loop - which is what lets the gate be asked here, per claim, with no
    // second read of the freeze and no batch-level check. Team id and player
    // id come off the claim row rather than the in-memory teams map, and the
    // bypass set is the award site's, so on this path the gate enforces the
    // freeze alone. The gate's DraftError propagates out unwrapped (409 and
    // its code intact); it is never caught per claim and converted into a
    // finish(claim, 'invalid'), which is the defect itself.
    const finish = async (claim, status, note) => {
      await assertRosterWriteAllowed(client, {
        leagueId,
        teamId: claim.team_id,
        direction: 'acquire',
        playerId: claim.player_id,
        bypass: [ROSTER_GATE.TEAM_LOCK, ROSTER_GATE.CAPACITY, ROSTER_GATE.POSITION_CAP, ROSTER_GATE.WAIVER_HOLD],
      });
      return client.query(
        `UPDATE "waiver_claims" SET "status" = $1, "note" = $2, "processed_at" = now(), "updated_at" = now()
         WHERE "id" = $3`,
        [status, note || null, claim.id]
      );
    };

    // ONE global walk over every due claim in the league (ADR 0048): bid (FAAB),
    // Waiver priority, the team's Claim order, then submission. Each claim is
    // re-validated at its own turn against the roster the earlier wins left.
    const results = [];
    const wonPlayers = new Set();
    const wonByTeam = new Map(); // team_id -> claims that team won this run, in order
    // Each team's PENDING claims by Claim order (due or not: due times are per
    // player, and Claim order ranks all of a manager's pending claims): a
    // claim's rank in a note is its position here, not the stored claim_order
    // (which keeps gaps).
    const pendingResult = await client.query(
      `SELECT "waiver_claims".* FROM "waiver_claims"
       WHERE "waiver_claims"."league_id" = $1 AND "waiver_claims"."status" = 'pending'`,
      [leagueId]
    );
    const rankOf = new Map();
    const byTeam = new Map();
    for (const c of orderClaims(pendingResult.rows, new Map(), 'priority')) {
      byTeam.set(c.team_id, [...(byTeam.get(c.team_id) || []), c]);
    }
    for (const list of byTeam.values()) list.forEach((c, i) => rankOf.set(c.id, i + 1));
    // The same comparator picks the next claim after every win, so a winner's
    // move to the back of the Waiver priority order (below) is seen by the
    // claims still to come, as it always was.
    const remaining = [...dueResult.rows];
    // claim id -> was roster capacity already what blocked it before this team's
    // first win of the run? Read once, just before that first win, so a
    // capacity note can be causal (see siblingReason).
    const capacityBlockedBefore = new Map();
    while (remaining.length > 0) {
      const claim = orderClaims(remaining, priorities, league.waiver_type)[0];
      remaining.splice(remaining.indexOf(claim), 1);
      const playerId = claim.player_id;
      const team = teams.get(claim.team_id);
      if (wonPlayers.has(playerId)) {
        await finish(claim, 'lost', 'a higher claim won this player');
        await notify(client, {
          userId: team.user_id,
          leagueId,
          type: 'waiver_result',
          message: 'Your waiver claim did not go through.',
          data: { claimId: claim.id, playerId },
        });
        continue;
      }
      const failure = await claimFailureReason(client, { league, team, claim });
      if (failure) {
        const note = await siblingReason(client, {
          failure, claim, won: wonByTeam.get(team.id) || [], rankOf, capacityBlockedBefore,
        });
        await finish(claim, 'invalid', note);
        await notify(client, {
          userId: team.user_id,
          leagueId,
          type: 'waiver_result',
          message: 'Your waiver claim did not go through.',
          data: { claimId: claim.id, playerId },
        });
        results.push({ claimId: claim.id, playerId, status: 'invalid', reason: note });
        continue;
      }

      if (!wonByTeam.has(team.id)) {
        for (const other of remaining.filter((c) => c.team_id === team.id)) {
          const before = await claimFailureReason(client, { league, team, claim: other });
          capacityBlockedBefore.set(other.id, Boolean(before && before.startsWith('roster capacity')));
        }
      }

      // The write-time roster gate (#944), once per claim immediately before
      // this claim's write: a claim submitted before a freeze must not land
      // during it (#940 story 4). The gate reads the freeze off the League row
      // it re-locks FOR UPDATE (the League is already held from the top of
      // processWaivers, League-first order); a frozen League throws, the
      // transaction rolls back, and every due claim stays pending for the next
      // tick rather than being awarded or permanently invalidated. The team
      // lock and the acquire bundle are bypassed: this batch path enforces its
      // net capacity through claimFailureReason above and does not enforce the
      // position cap or the on-waivers gate (a waiver award IS a waiver), and
      // per-team-lock handling on the batch path is a later ticket - so this
      // slice changes only the freeze here (#944 criterion 5).
      await assertRosterWriteAllowed(client, {
        leagueId,
        teamId: team.id,
        direction: 'acquire',
        playerId,
        bypass: [ROSTER_GATE.TEAM_LOCK, ROSTER_GATE.CAPACITY, ROSTER_GATE.POSITION_CAP, ROSTER_GATE.WAIVER_HOLD],
      });

      // Execute: optional drop (dropped player goes on waivers), then add
      if (claim.drop_player_id) {
        await client.query(
          `DELETE FROM "team_players" WHERE "team_id" = $1 AND "player_id" = $2`,
          [team.id, claim.drop_player_id]
        );
        // The lineup follows the roster (#197). No interrupted-stash
        // record here: a waiver-claim drop is not undoable, so there is
        // nothing for an undo to replay.
        //
        // This is the third drop-to-waivers sequence and the one that
        // deliberately stays open-coded: `placeOnWaiversUndoable` above
        // exists for the two that ARE undoable, and routing this one
        // through it would write a hold advertising an undo no route
        // offers (#222). The omission is the behaviour, not a shortcut.
        await lineupService.removeLineupEntries(client, {
          league, teamId: team.id, playerId: claim.drop_player_id,
        });
        await placeOnWaivers(client, {
          leagueId,
          playerId: claim.drop_player_id,
          waiverPeriodHours: league.waiver_period_hours,
        });
      }
      await client.query(
        `INSERT INTO "team_players" ("league_id", "team_id", "player_id") VALUES ($1, $2, $3)`,
        [leagueId, team.id, playerId]
      );
      // A won claim lands on the bench, never back in an old stash (#94).
      await lineupService.benchAcquiredPlayer(client, { league, teamId: team.id, playerId });
      if (league.waiver_type === 'faab' && claim.bid > 0) {
        await client.query(
          `UPDATE "teams" SET "faab_remaining" = "faab_remaining" - $1, "updated_at" = now() WHERE "id" = $2`,
          [claim.bid, team.id]
        );
      }
      // Winner goes to the back of the waiver order
      const oldPriority = priorities.get(team.id);
      await client.query(
        `UPDATE "teams" SET "waiver_priority" = "waiver_priority" - 1, "updated_at" = now()
         WHERE "league_id" = $1 AND "waiver_priority" > $2`,
        [leagueId, oldPriority]
      );
      await client.query(
        `UPDATE "teams" SET "waiver_priority" = $1, "updated_at" = now() WHERE "id" = $2`,
        [teamCount, team.id]
      );
      // Keep the in-memory order consistent for later players in this run
      for (const [tid, p] of priorities) {
        if (tid === team.id) priorities.set(tid, teamCount);
        else if (p > oldPriority) priorities.set(tid, p - 1);
      }

      await finish(claim, 'won', null);
      await logTransaction(client, {
        leagueId,
        teamId: team.id,
        type: 'waiver',
        detail: {
          playerId,
          droppedPlayerId: claim.drop_player_id || null,
          bid: league.waiver_type === 'faab' ? claim.bid : undefined,
        },
      });
      await notify(client, {
        userId: team.user_id,
        leagueId,
        type: 'waiver_result',
        message: 'Your waiver claim was successful!',
        data: { claimId: claim.id, playerId },
      });
      wonPlayers.add(playerId);
      wonByTeam.set(team.id, [...(wonByTeam.get(team.id) || []), claim]);
      results.push({ claimId: claim.id, playerId, status: 'won', teamId: team.id });
    }

    // Expired waiver windows are spent — clear them so players become free agents
    await client.query(
      `DELETE FROM "waiver_players" WHERE "league_id" = $1 AND "available_at" <= now()`,
      [leagueId]
    );
    await spendExpiredBlanketWindow(client, leagueId);

    return { processed: dueResult.rows.length, results };
    },
    { label: 'waiver-process' }
  );
  await getDraftRoomBroadcast().rosterChanged(leagueId);
  return result;
}

/**
 * The note for a claim that failed its turn. When an earlier claim of the SAME
 * team, won this run, is what made it fail, the note names that claim by its
 * Claim order ("your #1 claim already dropped X", "roster full after your #2
 * claim", "budget spent by your #1 claim"); otherwise the plain reason stands.
 * `won` is the team's claims already won this run, in the order they won.
 */
async function siblingReason(client, { failure, claim, won, rankOf, capacityBlockedBefore }) {
  if (won.length === 0) return failure;
  if (claim.drop_player_id && failure.startsWith('the player you offered to drop')) {
    const sibling = won.find((w) => w.drop_player_id === claim.drop_player_id);
    if (sibling) {
      const named = await client.query(`SELECT "name" FROM "players" WHERE "id" = $1`, [claim.drop_player_id]);
      const name = named.rows[0] ? named.rows[0].name : 'that player';
      return `your #${rankOf.get(sibling.id)} claim already dropped ${name}`;
    }
  }
  if (failure.startsWith('bid exceeds remaining FAAB budget')) {
    const sibling = [...won].reverse().find((w) => w.bid > 0);
    if (sibling) return `budget spent by your #${rankOf.get(sibling.id)} claim`;
  }
  // Causal: only when the claim would have fit before this team's wins this
  // run. A swap on an already-full roster frees exactly the slot it takes, so
  // a claim blocked by capacity before and after keeps the plain reason.
  if (failure.startsWith('roster capacity') && capacityBlockedBefore.get(claim.id) === false) {
    return `roster full after your #${rankOf.get(won[won.length - 1].id)} claim`;
  }
  return failure;
}

/** Why can't this claim execute right now? null = it can. */
async function claimFailureReason(client, { league, team, claim }) {
  const rostered = await client.query(
    `SELECT 1 FROM "team_players" WHERE "league_id" = $1 AND "player_id" = $2`,
    [league.id, claim.player_id]
  );
  if (rostered.rows[0]) return 'player is no longer available';

  if (league.waiver_type === 'faab') {
    const faab = await client.query(`SELECT "faab_remaining" FROM "teams" WHERE "id" = $1`, [team.id]);
    if (claim.bid > faab.rows[0].faab_remaining) return 'bid exceeds remaining FAAB budget';
  }

  let dropValid = false;
  if (claim.drop_player_id) {
    const onTeam = await client.query(
      `SELECT 1 FROM "team_players" WHERE "team_id" = $1 AND "player_id" = $2`,
      [team.id, claim.drop_player_id]
    );
    dropValid = Boolean(onTeam.rows[0]);
    if (!dropValid) return 'the player you offered to drop is no longer on your roster';
  }
  return capacityFailureReason(client, {
    league,
    team,
    dropPlayerId: dropValid ? claim.drop_player_id : null,
  });
}

/**
 * Kickoff hold (#1375, ADR 0043): the scheduler's kickoff tick. Writes the
 * same `waiver_players` row a drop writes, with no dropping team, for every
 * unrostered player on every kicked-off NFL team, in every league whose
 * draft is complete - the same `fantasySeasonLiveWhereSql` eligibility the
 * other weekly jobs already use, so a league still drafting or a
 * pick'em-only league (which never satisfies that fragment) sees nothing.
 * Runs once per scheduler tick, before claim processing, so a claim
 * submitted this tick already sees the hold.
 *
 * The week clear is the week's LAST kickoff - every game on the slate, not
 * only the kicked-off team's own - plus the league's `waiver_period_hours`.
 * `weekLastKickoff` is the same instant best ball's
 * `playersNotHeldAtLastKickoff` already computes (ADR 0022); `kickedOffTeams`
 * is the lineup lock's own per-team predicate (#228). Both are exposed from
 * lineup.service rather than recomputed here. Team codes go through the
 * shared NFL team normaliser (`normalizeNflTeam`) on the player side, so a
 * variant code (the WSH/WAS class) still matches the kicked-off set the
 * schedule side already normalised.
 *
 * The write is `placeOnWaivers` unmodified for this caller: greater-of on
 * conflict, dropping team and interrupted-stash columns never touched, so a
 * row a drop already wrote survives a tick untouched apart from its clear
 * time, and a tick's row survives a later drop the same way.
 *
 * A league with no kicked-off team this tick, or no schedule for its current
 * week, is skipped with no query against `players` - the common case on
 * every tick between kickoffs. One league's failure is logged and does not
 * stop the rest, matching every other per-league duty the tick runs.
 *
 * The candidate query also excludes a player already held at or past this
 * week's clear (#1375 review f2): without it, every already-held player on a
 * kicked-off team gets a `placeOnWaivers` round trip - a no-op ON CONFLICT
 * write that still stamps `updated_at` - on EVERY tick from the week's first
 * kickoff until the week advances, across every complete-draft league. The
 * exclusion is a read filter, not a second copy of the conflict rule:
 * `placeOnWaivers` stays the one place greater-of and the untouched columns
 * are decided; this only decides which players are worth asking it about.
 *
 * The candidate SELECT and the per-player upserts are separate statements
 * with no shared lock (#1375 review f3): a player rostered between the two
 * - a commissioner force, or a manager Add in the moment before his team's
 * kickoff - can end up with a waiver hold row while rostered. That row is
 * inert everywhere a rostered player's availability is read (every reader
 * checks `team_players` before `waiver_players`, see player.router.js), so
 * it is a stray row, not a wrong answer, until it expires or a later drop
 * overwrites it - EXCEPT the roster gate's waiver-hold check, which is
 * player-keyed and does not itself check current roster status, so a stray
 * row can refuse a trade for this player as "on waivers" until the row
 * clears. Left as a documented, narrow race rather than guarded: closing it
 * needs either an all-candidates single-transaction pass (which would hold
 * the whole league's unrostered pool locked for the write) or a re-check
 * inside `placeOnWaivers` itself (which would make the drop path pay for a
 * check only this caller needs) - both a larger change than this fix. The
 * window runs from the league's candidate SELECT to that player's own
 * upsert, and the upserts run one by one, so for the last candidate it spans
 * up to that whole league's per-player pass, not the whole tick.
 */
async function holdKickedOffPlayers({ now = new Date() } = {}) {
  const leaguesResult = await pool.query(
    `SELECT "id", "current_season", "current_week", "waiver_period_hours"
     FROM "leagues" WHERE ${fantasySeasonLiveWhereSql()}`
  );
  let held = 0;
  for (const league of leaguesResult.rows) {
    try {
      held += await holdKickedOffPlayersForLeague(league, now);
    } catch (err) {
      console.error('kickoff waiver hold failed for league %s:', league.id, err.message);
    }
  }
  return held;
}

/** One league's slice of `holdKickedOffPlayers`, above. */
async function holdKickedOffPlayersForLeague(league, now) {
  const {
    id: leagueId,
    current_season: season,
    current_week: week,
    waiver_period_hours: waiverPeriodHours,
  } = league;
  if (season == null || week == null) return 0;

  const kickedOff = await lineupService.kickedOffTeams(pool, { season, week, now });
  if (kickedOff.size === 0) return 0; // no team on this week's slate has kicked off yet

  const lastKickoff = await lineupService.weekLastKickoff(pool, { season, week });
  if (!lastKickoff) return 0; // no schedule rows for this week

  const availableAt = new Date(lastKickoff.getTime() + waiverPeriodHours * 60 * 60 * 1000);

  // A player already held at or past this week's clear (an earlier tick's own
  // write, or a drop's clear that is later still, per the greater-of rule)
  // needs no write this tick: `placeOnWaivers` would take the ON CONFLICT
  // branch and touch `updated_at` for no change, on every one of these per
  // league until the week advances (#1375 review f2). Excluding them here
  // keeps `placeOnWaivers` the one place the conflict rule lives - this is a
  // candidate filter, not a second copy of it.
  const candidatesResult = await pool.query(
    `SELECT "players"."id", "players"."nfl_team"
     FROM "players"
     WHERE "players"."nfl_team" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM "team_players"
         WHERE "team_players"."league_id" = $1 AND "team_players"."player_id" = "players"."id"
       )
       AND NOT EXISTS (
         SELECT 1 FROM "waiver_players"
         WHERE "waiver_players"."league_id" = $1 AND "waiver_players"."player_id" = "players"."id"
           AND "waiver_players"."available_at" >= $2::timestamptz
       )`,
    [leagueId, availableAt]
  );

  let held = 0;
  for (const row of candidatesResult.rows) {
    if (!kickedOff.has(normalizeNflTeam(row.nfl_team))) continue;
    await placeOnWaivers(pool, { leagueId, playerId: row.id, waiverPeriodHours, availableAt });
    held += 1;
  }
  return held;
}

/** Scheduler entry point: process every league whose waiver availability changed. */
async function processAllDueWaivers() {
  const due = await pool.query(
    `SELECT DISTINCT "waiver_claims"."league_id"
     FROM "waiver_claims"
     LEFT JOIN "waiver_players" ON "waiver_players"."league_id" = "waiver_claims"."league_id"
       AND "waiver_players"."player_id" = "waiver_claims"."player_id"
     LEFT JOIN "leagues" ON "leagues"."id" = "waiver_claims"."league_id"
     WHERE "waiver_claims"."status" = 'pending'
       AND COALESCE("waiver_players"."available_at", "leagues"."waivers_clear_at", now()) <= now()
     UNION
     SELECT DISTINCT "league_id" FROM "waiver_players" WHERE "available_at" <= now()
     UNION
     SELECT "id" AS "league_id" FROM "leagues" WHERE "waivers_clear_at" <= now()`
  );
  const outcomes = [];
  for (const row of due.rows) {
    try {
      outcomes.push({ leagueId: row.league_id, ...(await processWaivers({ leagueId: row.league_id })) });
    } catch (err) {
      console.error('waiver processing failed for league %s:', row.league_id, err.message);
    }
  }
  return outcomes;
}

module.exports = {
  WaiverError,
  claimTarget,
  claimFailureReason,
  orderClaims,
  placeOnWaivers,
  placeOnWaiversUndoable,
  isOnWaivers,
  submitClaim,
  cancelClaim,
  reorderClaims,
  processWaivers,
  processAllDueWaivers,
  holdKickedOffPlayers,
  openPostDraftWaiverWindow,
  seedWaiverPriorityFromDraftOrder,
};
