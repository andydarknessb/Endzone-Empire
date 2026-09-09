const pool = require('../modules/pool');
const { withTransaction } = require('../modules/withTransaction');
const { lookupTeam } = require('./teamIdentity');
const { getDraftRoomBroadcast } = require('../modules/draftRoomBroadcast');
const { logger } = require('../modules/logger');
const sentry = require('../modules/sentry');

// The board-fact methods a Draft act (CONTEXT.md) may legitimately name in its
// `broadcasts` set. runDraftAct validates requested names against this set
// before COMMIT so a typo fails loudly rather than silently in the contained
// fan-out. It is also the artifact a future slice reads to decide what a Draft
// act may emit, so the test is OWNERSHIP - which module owns the board fact
// (CONTEXT.md), and whether a lifecycle act can legitimately produce it - NOT
// whether a converted body happens to request it yet (only pause is converted
// so far, and it requests just stateChanged; that a name is unused today does
// not make it dead permission). Full ownership list and reasons, for all five
// board facts: ADR 0025's 2026-09-07 amendment. In short: a Draft act owns
// stateChanged and rosterChanged; pickLanded and draftCompleted are the Pick
// module's, and scoresUpdated is the scoring service's.
const BOARD_FACTS = new Set(['stateChanged', 'rosterChanged']);

/**
 * The Draft act module (#947, part of #938; see CONTEXT.md's Draft act
 * entry). It owns an ordering constraint
 * re-spelled across the repo - per the ticket, ten sites, five of them Express
 * handlers in draft.router.js that hand-roll their own transaction (measured:
 * draft.router.js had 7 pool.connect/BEGIN/COMMIT at 682fe470, 6 after this
 * conversion). The constraint: serialize on the League row, run the caller's
 * mutations on that same locked client, COMMIT, and only THEN fan out to the
 * room, in one order. A caller supplies an act body and never opens a
 * connection, never takes the lock, and never chooses the fan-out order.
 *
 * The shape it enforces, and the four properties draftAct.service.test.js pins
 * at this interface:
 *
 *  1. THE LOCK PRECEDES ANY MUTATION. runDraftAct takes `SELECT ... FOR UPDATE`
 *     on the League row as the first statement after BEGIN, before it loads
 *     Teams, resolves the acting Team, or hands the client to the act body. The
 *     body's first write is therefore always behind the lock.
 *  2. A THROWN REFUSAL ROLLS BACK AND EMITS NOTHING. Any throw from the body (a
 *     DraftError refusal or an unexpected fault) propagates through a ROLLBACK
 *     and past the fan-out, which never runs. The caller maps the refusal to its
 *     status; the room hears nothing.
 *  3. THE FAN-OUT RUNS ONLY AFTER COMMIT. The room is touched after
 *     `COMMIT` returns, never before, so a client can never observe an event for
 *     an act that then rolled back.
 *  4. A FAN-OUT FAILURE IS NOT A 500. The COMMIT is authoritative (ADR 0025): the
 *     act is durably done the moment COMMIT returns, so a room fan-out failure is
 *     reported once and swallowed, and the committed response is returned anyway.
 *     A client's reconnect refetch of draft:state is the backstop.
 *
 * THE FAN-OUT ORDER is the module's to choose, not the body's (that is the whole
 * point of #938: the same domain event must not leave in one order from the
 * router and the opposite order from pickClock.service.js). It emits the
 * narration first - every activity entry through `activityAppended` - and then
 * the board facts the body named, in their listed order. pickClock.service.js's
 * autoPick escalation branch (the activityAppended-then-stateChanged emit right
 * after escalateNothingDraftable) already emits this exact pair narration-first,
 * and pick.service.js's landPick leads its completion group with the narration
 * too (activityAppended ahead of rosterChanged/draftCompleted). #947 converted
 * pause/resume to that narration-first order and #967 finished the lifecycle set
 * (the autodraft toggle, undo and reset), which is what FLIPPED reset: it used
 * to emit stateChanged before activityAppended, and the module's order is now
 * the one it emits. draftFanoutOrder.test.js pins the router act and the
 * escalation path equal, so the two-process divergence #938 names cannot return
 * by an edit to either side alone. ONE board-fact-first site remains in
 * draft.router.js and is deliberately left alone: POST /correct-pick still emits
 * stateChanged before activityAppended. It is on no ticket, so this note is the
 * only place it surfaces. (Cited by function, not line, so a later edit cannot
 * silently misdirect the reference.)
 *
 * NO "ALREADY INSIDE AN ACT" MODE (load-bearing for the followers, #938). This
 * module always opens its own connection and takes its own lock; it offers no
 * way to run a body against a client that already holds the League lock. So a
 * caller that is already inside an act must NOT call runDraftAct - it would take
 * the same League-row lock on a second connection and self-deadlock. This is why
 * draftSchedule.service.js returns early before pool.connect() so the Draft
 * start's own lock is not nested. A later slice that needs a nested act must add
 * an injected-client escape hatch here (accept an optional live client and skip
 * BEGIN/lock/COMMIT when given one); it does not exist yet because no converted
 * handler needs it.
 */
async function runDraftAct({ leagueId, userId }, actBody) {
  // withTransaction owns connect, BEGIN, COMMIT-or-guarded-ROLLBACK and the
  // release rule (ADR 0033). runDraftAct is otherwise unchanged as its callers
  // and tests see it: the work takes the League lock, loads Teams, resolves the
  // acting Team, runs the caller's actBody, and validates the requested board
  // facts before the wrapper COMMITs; runFanout stays AFTER the call, so the
  // commit-then-fan-out ordering (F3) is preserved. A thrown refusal still rolls
  // back and emits nothing (F2), now through the wrapper.
  const { response, activity, broadcasts } = await withTransaction(pool, async (client) => {
    // 1. The serializing lock on the League row, before any mutation. Generic on
    // purpose: the module does not know a given act's authorization rule, so it
    // locks the row and hands it to the body, which authorizes against it.
    const leagueResult = await client.query(
      `SELECT * FROM "leagues" WHERE "id" = $1 FOR UPDATE`,
      [leagueId]
    );
    const league = leagueResult.rows[0] || null;
    // 2. Teams in rotation order (draft_position seed order, the same order the
    // rest of the draft rotates through), for a body that resolves the on-clock
    // team or rewrites the order. INVARIANT: this snapshot takes NO per-row lock,
    // so a body that gates or deletes per Team (reset, undo) is complete for the
    // whole act only because every Team-insert serializes behind this same League
    // lock (joinLeague locks the League row FOR UPDATE before its INSERT); a Team
    // created mid-act would be neither gated nor wiped. server/test/
    // teamInsertLockGuard.test.js guards that (#1043) so a new join or add-team
    // path cannot silently reopen the gap.
    const teamsResult = await client.query(
      `SELECT "id", "owner_id", "autodraft", "draft_position"
         FROM "teams" WHERE "league_id" = $1
        ORDER BY "draft_position" NULLS LAST, "id"`,
      [leagueId]
    );
    const teams = teamsResult.rows;
    // 3. The acting Team, or null when the caller holds none in this league. An
    // identity read (never an authorization one): a body that must refuse a
    // non-member does so itself.
    const actingTeam = await lookupTeam(client, { leagueId, userId });
    // 4. The caller's mutations, against the locked client.
    const outcome = (await actBody({ client, league, teams, actingTeam })) || {};
    const { response, activity = [], broadcasts = [] } = outcome;
    // Validate the requested board-fact names BEFORE commit, so a typo throws onto
    // the rollback path (visible) instead of vanishing into runFanout's deliberate
    // swallow, where a bad name would be a silent no-op the room never hears (F3).
    // Checked against a static allowlist rather than the live adapter on purpose:
    // resolving getDraftRoomBroadcast() here would move the "no transport
    // registered" throw (#765) onto the rollback path too, which contradicts the
    // post-commit containment pick.service.landPick deliberately chose so a
    // committed act is never misreported as failed. The typo - a wrong name - is
    // caught here; the missing transport stays the post-commit swallow.
    for (const method of broadcasts) {
      if (!BOARD_FACTS.has(method)) {
        throw new Error(
          `draftAct: '${method}' is not a board-fact broadcast (expected one of ${[...BOARD_FACTS].join(', ')}); ` +
            'narration goes through `activity`, not `broadcasts`'
        );
      }
    }
    // 5. Return the act's outcome; the wrapper COMMITs on return. From here the
    // act is durable. A pre-commit throw (a refusal, or the board-fact typo
    // check above) unwinds through the wrapper's ROLLBACK instead, and never
    // reaches the fan-out.
    return { response, activity, broadcasts };
  }, { label: 'draftAct' });
  // 6. Fan out, after commit, in the one order, contained.
  await runFanout({ leagueId, activity, broadcasts });
  return response;
}

/**
 * The one fan-out order (see the module header). Narration first: each activity
 * entry through `activityAppended`, then the named board-fact methods in order.
 * Contained exactly like pick.service.landPick: the COMMIT already made the act
 * durable, so a broadcast failure is reported once, never thrown, and never
 * turns a committed act into a 500.
 */
async function runFanout({ leagueId, activity, broadcasts }) {
  try {
    const broadcast = getDraftRoomBroadcast();
    for (const entry of activity) {
      await broadcast.activityAppended(leagueId, entry);
    }
    for (const method of broadcasts) {
      await broadcast[method](leagueId);
    }
  } catch (error) {
    logger.error({ err: error, leagueId }, 'Draft act committed but room fan-out failed');
    sentry.captureError(error, { leagueId });
  }
}

module.exports = { runDraftAct };
