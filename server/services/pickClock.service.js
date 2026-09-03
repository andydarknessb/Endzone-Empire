const pool = require('../modules/pool');
// Required as a module object (not destructured at load) so captureError stays a
// mockable seam for the overdue-alarm and catch-routing tests (#768).
const sentry = require('../modules/sentry');
const { teamForPick } = require('./draftOrder.service');
const { getDraftRoomBroadcast } = require('../modules/draftRoomBroadcast');
const { lastCompletedNflSeason } = require('./nflSeason.service');
const bestAvailable = require('./bestAvailable.service');
const startingNeed = require('./startingNeed');
const { parseLineupSettings } = require('./lineup.service');
const { draftRounds } = require('./rosterShape');
// draftActivity requires only teamIdentity, so there is no cycle back to this
// module (unlike pick.service, required lazily in autoPick): a top-level
// require is safe.
const { appendLifecycleActivity, STALLED } = require('./draftActivity');

/**
 * The Pick clock (CONTEXT.md), one owner. Every way a turn begins or a Pick
 * clock re-arms goes through a named event here, and every event arms by the
 * ONE policy below: an Autodraft team gets the short delay (floored at one
 * second, even in an untimed league), a timed team gets the full pick time, an
 * untimed non-autodrafting team gets no clock. Resume grants the policy clock,
 * never the time remaining at pause: pausing forgives elapsed time (ADR 0018).
 *
 * This module is the only writer of `leagues.pick_deadline_at` and, for the
 * turn-advancing events, of `leagues.current_pick`. A direct UPDATE of either
 * column outside it is a defect (ADR 0018). Every event takes the caller's own
 * transaction `client` (the league row already locked FOR UPDATE by the caller)
 * and performs its turn-advance and clock-arm as a single atomic statement, so
 * an observer never sees a new turn without its clock.
 *
 * The module also OWNS EXPIRY (#600): the sweep entry point below is the only
 * thing that concludes a clock expired, and the Autopick act it drives (the
 * queue first, then Best available among players who fill a Starting need, then
 * Best available among everyone else, with the snipe retry - ADR 0026) and the
 * consecutive-timeout streak live here too. The clock re-arm on a committed autopick still rides the
 * pick-landed event through pick.service.landPick, so expiry and arming
 * share the one policy. pick.service is required lazily inside autoPick because
 * it requires this module in turn (ADR 0018, #782 ruling 6); a top-level require
 * would capture its partial exports during the cycle.
 */

const AUTODRAFT_DELAY_FLOOR = 1;

// Defensive bound on landPick() attempts after a snipe - not a ranking cutoff.
const AUTOPICK_CANDIDATE_LIMIT = 25;

/**
 * The Overdue tolerance (#768, ruling 1): a Pick clock is Overdue only once its
 * deadline has been elapsed for longer than this, and still undischarged. 30s is
 * three #614 backstop intervals - long enough that a single late arm or a slow
 * candidate walk does not false-alarm, short enough that a genuinely stuck clock
 * surfaces fast. This is the ONE spelling of the tolerance; the #769 client half
 * pins its copy to this export by a parity test, so the export name and location
 * are load-bearing. Never inline the number.
 */
const OVERDUE_AFTER_MS = 30_000;

/**
 * The three pg Pool counters (#768, ruling 4) as Sentry-extra fields. Every
 * capture from this ticket rides them, so a stuck-clock alarm carries whether
 * the connection pool was also saturated at the time. Read off the live Pool
 * instance the module already uses for queries.
 */
function poolCounters() {
  return {
    'pool.totalCount': pool.totalCount,
    'pool.idleCount': pool.idleCount,
    'pool.waitingCount': pool.waitingCount,
  };
}

/**
 * Pure: seconds on the clock for the next pick, or null for "no clock". An
 * autodrafting team always gets the short autodraft delay (even in an otherwise
 * untimed draft, and never below one second); everyone else gets the league
 * pick clock, which is null when the league is untimed or the draft is over.
 * This is the single spelling of the arming policy every event consults.
 */
function nextPickClockSeconds({ draftComplete, nextTeamAutodraft, pickTimeSeconds, autodraftDelaySeconds }) {
  if (draftComplete) return null;
  if (nextTeamAutodraft) return Math.max(AUTODRAFT_DELAY_FLOOR, autodraftDelaySeconds || AUTODRAFT_DELAY_FLOOR);
  return pickTimeSeconds > 0 ? pickTimeSeconds : null;
}

/**
 * The policy above, plus the offline rule: an offline draft never arms a
 * deadline regardless of a team's autodraft flag or the league's configured
 * pick clock, because its picks only ever land via commissioner entry. `league`
 * carries draft_type, pick_time_seconds and autodraft_delay_seconds.
 */
function clockSecondsFor({ draftComplete, onClockAutodraft, league }) {
  if (league.draft_type === 'offline') return null;
  return nextPickClockSeconds({
    draftComplete,
    nextTeamAutodraft: onClockAutodraft,
    pickTimeSeconds: league.pick_time_seconds,
    autodraftDelaySeconds: league.autodraft_delay_seconds,
  });
}

/**
 * Draft started: the pending -> active (or, on an all-keeper start, pending ->
 * complete) transition. Fixes draft_rounds at this instant (ADR 0005) and, on
 * the active branch, arms the first open pick's clock from the policy seconds
 * the start plan resolved. This is the one statement that advances current_pick
 * and arms the deadline together for the start event.
 */
async function onDraftStarted(client, { leagueId, complete, currentPick, clockSeconds, rounds }) {
  if (complete) {
    // Every roster slot was pre-filled by keepers: no live pick is possible, so
    // the draft is complete before it began. No clock, and the waiver window
    // opens exactly as it would on the final live pick.
    await client.query(
      `UPDATE "leagues"
         SET "draft_status" = 'complete', "current_pick" = $2, "updated_at" = now(),
             "draft_autostart_failed" = false, "pick_deadline_at" = NULL,
             "draft_rounds" = $3,
             "waivers_clear_at" = now() + make_interval(hours => "waiver_period_hours")
       WHERE "id" = $1`,
      [leagueId, currentPick, rounds]
    );
    return null;
  }
  const result = await client.query(
    `UPDATE "leagues"
       SET "draft_status" = 'active', "current_pick" = $2, "updated_at" = now(),
           "draft_autostart_failed" = false,
           "draft_rounds" = $4,
           "pick_deadline_at" = CASE
             WHEN $3::int IS NULL THEN NULL
             ELSE now() + make_interval(secs => $3::int)
           END
     WHERE "id" = $1
     RETURNING "pick_deadline_at"`,
    [leagueId, currentPick, clockSeconds, rounds]
  );
  return result.rows[0] ? result.rows[0].pick_deadline_at : null;
}

/**
 * Pick landed: advance the turn to the next open pick (or, on the final pick,
 * to the completed state) and arm the next team's clock, in one statement so
 * the turn advance and clock arm stay atomic (ADR 0018). draft_status rides the
 * same statement because the final pick's advance IS the completion; the
 * completion side effects the caller runs afterward depend on that status being
 * set first (#194). `nextTeam` is the resolved team now on the clock (null once
 * the draft completes); `league` carries the clock settings.
 */
async function onPickLanded(client, { leagueId, nextPick, draftStatus, draftComplete, nextTeam, league }) {
  const clockSeconds = clockSecondsFor({
    draftComplete,
    onClockAutodraft: nextTeam ? nextTeam.autodraft : false,
    league,
  });
  const result = await client.query(
    `UPDATE "leagues"
       SET "current_pick" = $1, "draft_status" = $2, "updated_at" = now(),
           "pick_deadline_at" = CASE
             WHEN $4::int IS NULL THEN NULL
             ELSE now() + make_interval(secs => $4::int)
           END
     WHERE "id" = $3
     RETURNING "pick_deadline_at"`,
    [nextPick, draftStatus, leagueId, clockSeconds]
  );
  return result.rows[0].pick_deadline_at;
}

/** Paused: the draft is paused, so the clock is cleared. Pausing forgives elapsed time. */
async function onPaused(client, { leagueId }) {
  const result = await client.query(
    `UPDATE "leagues" SET "pick_deadline_at" = NULL, "updated_at" = now()
     WHERE "id" = $1 RETURNING "pick_deadline_at"`,
    [leagueId]
  );
  return result.rows[0] ? result.rows[0].pick_deadline_at : null;
}

/**
 * Resumed: arm the on-the-clock team's policy clock, never the time remaining at
 * pause (ADR 0018). This is the fix for the resume freeze: an autodrafting team
 * gets the short delay even in an untimed league (never NULL) and the short
 * delay in a timed league (never the full pick clock). Resolves the on-clock
 * team from the same rotation the rest of the draft uses, then arms without
 * advancing the turn (the same team stays on the clock through a pause).
 */
async function onResumed(client, { leagueId }) {
  const leagueResult = await client.query(
    `SELECT "current_pick", "draft_type", "draft_rotation", "draft_order_overrides",
            "pick_time_seconds", "autodraft_delay_seconds"
       FROM "leagues" WHERE "id" = $1`,
    [leagueId]
  );
  const league = leagueResult.rows[0];
  if (!league) return null;
  const teamsResult = await client.query(
    `SELECT "id", "autodraft", "draft_position" FROM "teams"
       WHERE "league_id" = $1 ORDER BY "draft_position" NULLS LAST, "id"`,
    [leagueId]
  );
  const onClock = teamForPick(league.current_pick, teamsResult.rows, {
    rotation: league.draft_rotation,
    overrides: league.draft_order_overrides,
  });
  const clockSeconds = clockSecondsFor({
    draftComplete: false,
    onClockAutodraft: onClock ? onClock.autodraft : false,
    league,
  });
  return armInPlace(client, { leagueId, clockSeconds });
}

/**
 * Autodraft toggled on for the team on the clock: arm the short autodraft delay
 * right away, so an absent owner's pick fires promptly. The team is autodrafting
 * by definition here (the caller only reaches this for enabling on the on-clock
 * team of an active, unpaused draft), so the policy resolves to the delay.
 * `league` carries the clock settings.
 */
async function onAutodraftToggled(client, { leagueId, league }) {
  // The team is autodrafting by definition here, so the policy resolves to the
  // short delay (floored at one second) for a timed or untimed league. It goes
  // through clockSecondsFor like every other event so there is one spelling
  // (ADR 0018): an offline draft arms no clock, matching the five siblings
  // rather than diverging (spec #598 user story 7). The toggle route reaches
  // this with an active offline draft (no draft_type guard on that path), so
  // `league` MUST carry draft_type or the offline rule would silently not apply.
  const clockSeconds = clockSecondsFor({ draftComplete: false, onClockAutodraft: true, league });
  return armInPlace(client, { leagueId, clockSeconds });
}

/**
 * Pick undone (commissioner undo): rewind current_pick to the earliest undone
 * pick's own slot and re-arm the team now on the clock by the policy, in one
 * statement. `onClockAutodraft` is that team's autodraft flag, resolved by the
 * caller from the rewound pick; `league` carries the clock settings.
 */
async function onPickUndone(client, { leagueId, newCurrentPick, onClockAutodraft, league }) {
  const clockSeconds = clockSecondsFor({ draftComplete: false, onClockAutodraft, league });
  const result = await client.query(
    `UPDATE "leagues"
       SET "current_pick" = $1, "updated_at" = now(),
           "pick_deadline_at" = CASE
             WHEN $3::int IS NULL THEN NULL
             ELSE now() + make_interval(secs => $3::int)
           END
     WHERE "id" = $2
     RETURNING "pick_deadline_at"`,
    [newCurrentPick, leagueId, clockSeconds]
  );
  return result.rows[0] ? result.rows[0].pick_deadline_at : null;
}

/**
 * Clear the clock without advancing the turn: a destructive reset back to
 * pending has no team on the clock and no deadline. (Commissioner correction
 * clears its own clock inside draft.service.js and is deliberately left
 * unchanged, #599.)
 */
async function clearClock(client, { leagueId }) {
  await client.query(
    `UPDATE "leagues" SET "pick_deadline_at" = NULL, "updated_at" = now() WHERE "id" = $1`,
    [leagueId]
  );
  return null;
}

/** The shared re-arm-in-place statement for the events that keep the same team on the clock. */
async function armInPlace(client, { leagueId, clockSeconds }) {
  const result = await client.query(
    `UPDATE "leagues"
       SET "updated_at" = now(),
           "pick_deadline_at" = CASE
             WHEN $2::int IS NULL THEN NULL
             ELSE now() + make_interval(secs => $2::int)
           END
     WHERE "id" = $1
     RETURNING "pick_deadline_at"`,
    [leagueId, clockSeconds]
  );
  return result.rows[0] ? result.rows[0].pick_deadline_at : null;
}

// --- Expiry: the Autopick act and the sweep (#600, ADR 0018) -----------------

/**
 * Order candidates for one team's autopick through the need-aware phases
 * (CONTEXT.md Autopick, ADR 0026):
 *   1. the team's own queue first, by the team's stated rank - SOVEREIGN, never
 *      position-filtered (a queued sixth quarterback is still honored);
 *   2. Best available among players who FILL A STARTING NEED (adding them raises
 *      the team's filled-starter count, computed by exact matching in
 *      startingNeed.js);
 *   3. Best available among everyone else.
 * Best available (ADP, then last completed season's points, then name; never
 * database id) is the comparator inside the need and bench phases (phase 1, the
 * queue, orders by the team's own stated rank instead), shared with the Draft
 * Sim's pool via bestAvailable.service.js's compareBestAvailable.
 *
 * Kickers and defenses are held out of phases 2 and 3 until the last three
 * rounds (startingNeed.KICKER_DEFENSE_WINDOW_ROUNDS), UNLESS the must-fill guard
 * fires: when the team has no more picks remaining than open Starting needs,
 * every remaining pick must fill a need, so K/DEF join the need phase and it
 * leads. A data problem (thin ADP) never refuses here - the phases fall through
 * to points then name, and the full board always follows as a fallback tail so
 * a sniped or cap-blocked candidate degrades to a pick rather than stalling
 * (#602, ADR 0026): even the must-fill path keeps that tail, so losing its one
 * or two K/DEF rows between here and the pick does not walk into escalation.
 *
 * Internal to this module: the ordering contracts are exercised through the
 * sweep interface (server/test/pickClock.sweep.test.js), not a test-only export
 * (ADR 0018).
 */
function orderAutopickCandidates(rows, { rosterSlots, rosterPositions, currentRound, draftRounds: rounds, picksRemaining }) {
  const isKickerOrDefense = (row) => row.position === 'K' || row.position === 'DEF';
  const byBestAvailable = (a, b) => bestAvailable.compareBestAvailable(a, b);

  // Phase 1: the queue, sovereign and never position-filtered.
  const queued = rows.filter((r) => r.queue_rank != null).sort((a, b) => a.queue_rank - b.queue_rank);
  const rest = rows.filter((r) => r.queue_rank == null);

  // Fills-a-need depends only on the candidate's position, so answer it once per
  // distinct position rather than once per candidate.
  const fillsByPosition = new Map();
  const fills = (position) => {
    if (!fillsByPosition.has(position)) {
      fillsByPosition.set(position, startingNeed.fillsStartingNeed({
        rosterSlots, roster: rosterPositions, candidatePosition: position,
      }));
    }
    return fillsByPosition.get(position);
  };

  const openNeeds = startingNeed.openStartingNeeds({ rosterSlots, roster: rosterPositions });
  const mustFill = openNeeds > 0 && picksRemaining <= openNeeds;
  const kdOpen = currentRound > rounds - startingNeed.KICKER_DEFENSE_WINDOW_ROUNDS;

  // The normal K/DEF-windowed phases: need first, then bench.
  const board = kdOpen ? rest : rest.filter((r) => !isKickerOrDefense(r));
  const needFillers = board.filter((r) => fills(r.position)).sort(byBestAvailable);
  const bench = board.filter((r) => !fills(r.position)).sort(byBestAvailable);

  let phased;
  if (mustFill) {
    // Every remaining pick must fill a need, so the need phase includes K/DEF
    // and leads. The normal phases follow as a fallback tail (deduped): if the
    // must-fillers are sniped or cap-blocked (409) between here and the pick,
    // autopick still degrades to a draftable player instead of escalating with
    // players left on the board (ADR 0026). Never an early return.
    const mustFillers = rest.filter((r) => fills(r.position)).sort(byBestAvailable);
    const seen = new Set(mustFillers);
    phased = [...mustFillers, ...needFillers.filter((r) => !seen.has(r)), ...bench.filter((r) => !seen.has(r))];
  } else {
    phased = [...needFillers, ...bench];
  }

  // Never refuse while a player is draftable (ADR 0026): if the phase filters
  // emptied a non-empty board (only K/DEF remain before their window), degrade
  // to the raw Best available instead of stalling.
  if (phased.length === 0 && rest.length > 0) phased = [...rest].sort(byBestAvailable);

  return [...queued, ...phased];
}

/**
 * Picks remaining for the on-clock team (ADR 0026): the count of pick numbers
 * from the current pick through the last round that the draft order assigns to
 * this team and that no draft_picks row already occupies (keeper picks are
 * pre-inserted). current_pick is 0-based; draft_picks.pick_number is 1-based,
 * so it is shifted to the 0-based index space the rotation math uses. Includes
 * the pick being made now, so "picks remaining <= open needs" reads as "no more
 * picks than needs".
 */
async function countPicksRemaining({ leagueId, league, teams, teamId, rounds }) {
  const totalPicks = rounds * teams.length;
  if (totalPicks <= 0) return 0;
  const takenRes = await pool.query(
    `SELECT "pick_number" FROM "draft_picks" WHERE "league_id" = $1 AND "pick_number" >= $2`,
    [leagueId, league.current_pick + 1]
  );
  const taken = new Set(takenRes.rows.map((r) => r.pick_number - 1));
  const rotationOpts = { rotation: league.draft_rotation, overrides: league.draft_order_overrides };
  let remaining = 0;
  for (let n = league.current_pick; n < totalPicks; n++) {
    if (taken.has(n)) continue;
    const team = teamForPick(n, teams, rotationOpts);
    if (team && team.id === teamId) remaining += 1;
  }
  return remaining;
}

/**
 * Server-side auto-pick for an expired clock: the team on the clock drafts
 * automatically through the need-aware phases (CONTEXT.md Autopick, ADR 0026) -
 * the queue first, then Best available among players who fill a Starting need,
 * then Best available among everyone else (see orderAutopickCandidates). The
 * committed pick re-arms the next team's clock
 * through pick.service.landPick -> onPickLanded, so expiry never writes the
 * deadline directly; it goes through the same arming policy as every other event.
 *
 * Candidate selection and the pick itself are separate transactions, so a
 * candidate can be sniped in between - landPick's own commit validation catches
 * that (409) and we simply try the next candidate.
 */
async function autoPick({ leagueId }) {
  // pick.service requires this module (ADR 0018), so landPick is required at call
  // time rather than at module load to avoid capturing its partial exports
  // mid-cycle (#782 ruling 6). shouldAutoEnableAutodraft (the streak/flip
  // decision, ruling 4) stays in draft.service and is required lazily beside it;
  // draft.service no longer requires this module, so it closes no cycle either.
  const { landPick } = require('./pick.service');
  const { shouldAutoEnableAutodraft } = require('./draft.service');

  const leagueResult = await pool.query(`SELECT * FROM "leagues" WHERE "id" = $1`, [leagueId]);
  const league = leagueResult.rows[0];
  if (!league || league.draft_status !== 'active' || league.draft_paused) return null;
  // Expiry guard (#601, ADR 0018): only an actually-elapsed clock autopicks.
  // This is one half of the timer-vs-sweep dedupe, and it covers exactly the
  // SEQUENCED case: a second firing (a re-armed timer, or a backstop straggler)
  // that arrives AFTER an earlier firing already advanced the turn reads the
  // next team's freshly-armed clock, which is null or still in the future, and
  // declines here. Without it that second firing would autopick the next team
  // early, committing a second Pick off one expiry. It does NOT cover the
  // CONCURRENT case (two firings that both read this same elapsed deadline
  // before either commits): both pass this check, and the loser is stopped one
  // level down by pick.service's turn re-check under FOR UPDATE (see autoPick's
  // 409 handling and fireExpiryTimer). A null deadline (untimed non-autodrafting
  // turn, or a completed draft) is likewise not an expiry and never autopicks.
  const deadline = league.pick_deadline_at;
  if (deadline == null || msUntilDeadline(deadline) > 0) return null;

  const teamsResult = await pool.query(
    `SELECT "id", "owner_id", "autodraft" FROM "teams"
     WHERE "league_id" = $1 ORDER BY "draft_position" NULLS LAST, "id"`,
    [leagueId]
  );
  const teams = teamsResult.rows;
  if (teams.length === 0) return null;
  const onTheClock = teamForPick(league.current_pick, teams, {
    rotation: league.draft_rotation,
    overrides: league.draft_order_overrides,
  });
  if (!onTheClock) return null;
  // A pick fired by an expired clock is a "timeout" only when the team isn't
  // already autodrafting on purpose.
  const wasTimeout = !onTheClock.autodraft;

  const lastSeason = await lastCompletedNflSeason();
  const candidatesRes = await pool.query(
    `SELECT "players"."id", "players"."name", "players"."adp", "players"."position",
            "draft_queue"."rank" AS "queue_rank",
            "season_points"."fantasy_points" AS "last_season_points"
     FROM "players"
     LEFT JOIN "team_players" ON "team_players"."player_id" = "players"."id"
       AND "team_players"."league_id" = $1
     LEFT JOIN "draft_queue" ON "draft_queue"."player_id" = "players"."id"
       AND "draft_queue"."team_id" = $2
     LEFT JOIN "player_season_stats" "season_points"
       ON "season_points"."player_id" = "players"."id" AND "season_points"."season" = $3
     WHERE "team_players"."id" IS NULL`,
    [leagueId, onTheClock.id, lastSeason]
  );

  // Need-aware ordering context (ADR 0026). The on-clock team's current
  // starting-eligible positions and the league's starting slots decide which
  // candidates fill a Starting need; the round and picks-remaining decide the
  // K/DEF window and the must-fill guard. All of it is read here and handed to
  // the pure ordering below.
  const rosterRes = await pool.query(
    `SELECT "players"."position"
     FROM "team_players"
     JOIN "players" ON "players"."id" = "team_players"."player_id"
     WHERE "team_players"."league_id" = $1 AND "team_players"."team_id" = $2`,
    [leagueId, onTheClock.id]
  );
  const rosterPositions = rosterRes.rows.map((row) => row.position);
  const { rosterSlots } = parseLineupSettings(league);
  const rounds = draftRounds(league);
  const currentRound = teams.length > 0 ? Math.floor(league.current_pick / teams.length) + 1 : 1;
  const picksRemaining = await countPicksRemaining({
    leagueId, league, teams, teamId: onTheClock.id, rounds,
  });

  const candidates = orderAutopickCandidates(candidatesRes.rows, {
    rosterSlots, rosterPositions, currentRound, draftRounds: rounds, picksRemaining,
  }).slice(0, AUTOPICK_CANDIDATE_LIMIT);

  for (const candidate of candidates) {
    try {
      // A Pick lands in one place (#782): landPick commits the autopick AND fans
      // it out to the room (pickLanded, and on completion the completion activity,
      // rosterChanged, draftCompleted) through the one Draft room adapter (#745).
      // The clock no longer re-derives that fan-out here - the socket handler and
      // the offline route reach the same seam.
      const outcome = await landPick({
        leagueId,
        userId: onTheClock.owner_id,
        playerId: candidate.id,
        auto: true,
      });
      // After a genuine timeout, track the streak and flip autodraft on once it
      // crosses the threshold, so a persistently-absent owner stops stalling. The
      // streak/flip stays with the clock (ADR 0018, ruling 4).
      if (wasTimeout) {
        const bumped = await pool.query(
          `UPDATE "teams" SET "consecutive_timeouts" = "consecutive_timeouts" + 1
           WHERE "id" = $1 RETURNING "consecutive_timeouts"`,
          [onTheClock.id]
        );
        if (shouldAutoEnableAutodraft(bumped.rows[0].consecutive_timeouts)) {
          await pool.query(`UPDATE "teams" SET "autodraft" = true WHERE "id" = $1`, [onTheClock.id]);
          await getDraftRoomBroadcast().stateChanged(leagueId);
        }
      }
      return outcome;
    } catch (err) {
      if (err.statusCode === 409) continue; // sniped or cap-blocked - next candidate
      throw err;
    }
  }
  // Nothing draftable for this expired turn (empty pool, full roster, or every
  // candidate sniped away): escalate instead of spinning silently (#602). The
  // pause is idempotent across the timer and the backstop sweep - see
  // escalateNothingDraftable - so a firing that loses the race pauses nothing
  // and appends nothing. autoPick still returns null either way, so neither fire
  // path commits a Pick or arms a clock for the now-paused draft.
  const escalation = await escalateNothingDraftable({ leagueId });
  if (escalation) {
    // Both ride the one Draft room adapter (#745). In the worker they publish
    // over the Redis emitter transport (the escalation runs there); stateChanged
    // refreshes the now-paused clock, computing the draft:state snapshot
    // in-process in either process (ADR 0025).
    const broadcast = getDraftRoomBroadcast();
    await broadcast.activityAppended(leagueId, escalation.activity);
    await broadcast.stateChanged(leagueId);
  }
  return null;
}

/**
 * Escalate an expired turn that produced no Autopick (#602). autoPick reaches
 * here only after every candidate for the on-clock team failed to draft, so
 * rather than returning to spin on the same elapsed deadline the module pauses
 * the Draft LOUDLY: it clears the clock, flips draft_paused, and appends a
 * STALLED Draft-activity entry naming the stuck Team, leaving the
 * paused-then-resumed repair shape commissioner correction established (ADR
 * 0018). current_pick is untouched, so the same Team is on the clock when a
 * commissioner resumes and onResumed arms its policy clock like any resume.
 *
 * IDEMPOTENT ACROSS BOTH FIRING PATHS (the reason #602 was sequenced behind
 * #601). A timer fire and a backstop sweep - or two timer fires - can both
 * reach a nothing-draftable turn. autoPick's own draft_paused check at its top
 * does NOT prevent that: both firings read draft_paused=false before either
 * pauses, so both pass it. The guarantee is made HERE instead, under the league
 * row's FOR UPDATE lock. The two firings serialize on that lock; the winner
 * pauses and appends, and the loser - re-reading draft_paused already true (and
 * the deadline already cleared) inside the lock - commits nothing and appends
 * no second entry. The invariant is NOT "only one firing reaches here" (both
 * do); it is "only the firing that still sees an active, unpaused draft on this
 * same elapsed deadline acts".
 *
 * The still-elapsed re-check covers a second race the pause check alone would
 * miss: a concurrent firing that did NOT hit nothing-draftable but committed a
 * real Pick for this turn (it drafted a candidate this firing could not, or won
 * the landPick FOR UPDATE turn re-check). That firing advanced current_pick
 * and armed the next team's fresh clock, so under the lock this firing reads a
 * future-or-null deadline and declines, rather than pausing a Draft that in
 * fact moved on.
 */
async function escalateNothingDraftable({ leagueId }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const leagueResult = await client.query(
      `SELECT * FROM "leagues" WHERE "id" = $1 FOR UPDATE`,
      [leagueId]
    );
    const league = leagueResult.rows[0];
    // A concurrent firing may have already paused (another escalation) or
    // advanced the turn and re-armed (a committed Pick). Decline in either case.
    if (!league || league.draft_status !== 'active' || league.draft_paused) {
      await client.query('ROLLBACK');
      return null;
    }
    const deadline = league.pick_deadline_at;
    if (deadline == null || msUntilDeadline(deadline) > 0) {
      await client.query('ROLLBACK');
      return null;
    }
    const teamsResult = await client.query(
      `SELECT "id", "name", "autodraft", "draft_position" FROM "teams"
         WHERE "league_id" = $1 ORDER BY "draft_position" NULLS LAST, "id"`,
      [leagueId]
    );
    const stuckTeam = teamForPick(league.current_pick, teamsResult.rows, {
      rotation: league.draft_rotation,
      overrides: league.draft_order_overrides,
    });
    // Pause and clear the clock in one statement. current_pick is deliberately
    // left unchanged so the same Team is on the clock at resume - no skipped-turn
    // concept is introduced (ADR 0018).
    await client.query(
      `UPDATE "leagues"
         SET "draft_paused" = true, "pick_deadline_at" = NULL, "updated_at" = now()
       WHERE "id" = $1`,
      [leagueId]
    );
    // Name the stuck Team on the entry so the feed says who the Draft is waiting
    // on. A missing on-clock team (defensive; autoPick already resolved one to
    // get here) records a null actor rather than fabricating one.
    const activity = await appendLifecycleActivity(client, {
      leagueId,
      kind: STALLED,
      team: stuckTeam ? { id: stuckTeam.id, name: stuckTeam.name } : null,
    });
    await client.query('COMMIT');
    return { activity };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// --- Hybrid expiry: in-process timers beside the stored deadline (#601) -------

/**
 * Armed in-process expiry timers, keyed by league id. The stored deadline on
 * the league row stays the authoritative fact (restart-proof, multi-process
 * safe); beside it the worker arms a timer so an expiry fires within about a
 * second of zero instead of on the next backstop poll (ADR 0018). Timers live
 * only in the process that armed them - the worker, where the sweep and the
 * autopick chain both run. A worker restart loses the Map, which is exactly why
 * the backstop sweep still exists: it re-arms timers for future deadlines and
 * autopicks any that already elapsed while the process was down.
 */
const expiryTimers = new Map();

/**
 * Overdue alarm episodes (#768, ruling 2), keyed `${leagueId}:${deadlineMs}`.
 * One Sentry event per (leagueId, deadlineAt): a new deadline is a new episode.
 * In-memory beside expiryTimers and lost on a worker restart, which is why a
 * post-restart re-alarm is accepted - the ['pick-clock-overdue', leagueId]
 * fingerprint groups it into the same Sentry issue rather than a new one. No
 * column, no migration. Cleared alongside the timers by cancelAllExpiryTimers.
 */
const overdueEpisodes = new Map();

function overdueEpisodeKey(leagueId, deadline) {
  return `${leagueId}:${new Date(deadline).getTime()}`;
}

/**
 * Raise one Sentry alarm for an Overdue clock, once per episode (#768, ruling
 * 2). Called from the sweep for an already-elapsed deadline: if its age exceeds
 * OVERDUE_AFTER_MS and this (leagueId, deadlineAt) episode has not alarmed yet,
 * capture it (fingerprinted so a league's alarms group, pool counters riding
 * along) and record the episode. An expired-but-not-Overdue clock, or a repeat
 * of an episode already seen, is silent. The sweep autopicks exactly as before
 * either way - this only observes.
 */
function alarmIfOverdue(leagueId, deadline) {
  const ageMs = -msUntilDeadline(deadline);
  if (ageMs <= OVERDUE_AFTER_MS) return;
  const key = overdueEpisodeKey(leagueId, deadline);
  if (overdueEpisodes.has(key)) return;
  overdueEpisodes.set(key, true);
  const error = new Error(
    `pick clock overdue for league ${leagueId}: ${Math.round(ageMs)}ms past the deadline`
  );
  sentry.captureError(
    error,
    { leagueId, path: 'sweep', deadlineAt: deadline, ageMs, ...poolCounters() },
    { fingerprint: ['pick-clock-overdue', String(leagueId)] }
  );
}

/**
 * Milliseconds from now until `deadline` (a Date or timestamp): positive while
 * the clock is still running, zero or negative once it has elapsed. The one
 * spelling of the clock-elapsed comparison, shared by the arming math, the
 * sweep's due split, and the expiry guard.
 *
 * Deliberate clock choice (#601): the deadline is written by Postgres
 * (now() + make_interval), but due-ness and the arm delay are evaluated here on
 * the worker's Node clock rather than a second `<= now()` round-trip to the DB.
 * Any offset between the app and DB clocks shifts firing by that offset - within
 * the spec's "about a second" target for co-located services, and self-limiting:
 * a slightly-early guard decline is re-armed by the next backstop pass, and a
 * slightly-late fire still autopicks. A fully DB-relative arm (returning
 * EXTRACT(EPOCH FROM (pick_deadline_at - now())) from the sweep and reading the
 * DB clock in the guard too) was weighed and left out as not worth the extra
 * read for a sub-second, backstopped effect.
 */
function msUntilDeadline(deadline) {
  return new Date(deadline).getTime() - Date.now();
}

/**
 * Arm (or re-arm) the in-process timer for one league's deadline. Re-arming is
 * idempotent: the previous timer for the league is always cleared first, so a
 * refresh from a later sweep does not stack a second timer. A null deadline
 * cancels without arming. The timer is unref'd so a pending expiry never keeps
 * the worker alive on its own.
 */
function armExpiryTimer(leagueId, deadline) {
  cancelExpiryTimer(leagueId);
  if (deadline == null) return;
  const fireInMs = Math.max(0, msUntilDeadline(deadline));
  const timer = setTimeout(() => {
    // This handle has fired and is spent. Drop it from the registry before
    // autopicking so the Map holds only live timers: if the autopick declines
    // (autoPick returns null and re-arms nothing) no stale handle is left
    // behind, and if it commits, its re-arm installs a fresh entry.
    expiryTimers.delete(leagueId);
    fireExpiryTimer(leagueId, deadline);
  }, fireInMs);
  if (typeof timer.unref === 'function') timer.unref();
  expiryTimers.set(leagueId, timer);
}

/** Cancel one league's armed timer if it has one. */
function cancelExpiryTimer(leagueId) {
  const timer = expiryTimers.get(leagueId);
  if (timer) {
    clearTimeout(timer);
    expiryTimers.delete(leagueId);
  }
}

/**
 * Tear down every armed timer. The scheduler calls this on stop so a test run
 * or a worker shutdown cannot leak a late Autopick from a timer that outlived
 * the interval that would have fed it (#601).
 */
function cancelAllExpiryTimers() {
  for (const timer of expiryTimers.values()) clearTimeout(timer);
  expiryTimers.clear();
  // The overdue-alarm episodes are the sibling in-memory expiry state; a full
  // teardown (scheduler stop, test reset) clears them too, so a fresh start
  // re-alarms an ongoing Overdue episode once - the same restart behaviour the
  // fingerprint already tolerates (#768).
  overdueEpisodes.clear();
}

/**
 * A fired timer autopicks its league, then re-arms itself for the turn the pick
 * advanced to, so a full Autodraft run moves at the short delay per pick rather
 * than waiting for the next backstop poll. Racing the sweep for the same
 * deadline is safe by two distinct mechanisms, not one: a firing that arrives
 * after the turn advanced is declined by autoPick's expiry guard (the next
 * deadline is future or null); two firings that read this same elapsed deadline
 * concurrently BOTH pass that guard, and the loser is stopped by
 * pick.service.landPick's turn re-check under FOR UPDATE, surfacing as the
 * 409 autoPick walks off its remaining candidates to a null outcome. Either way
 * exactly one Pick commits. A null outcome (not due, sniped off every candidate,
 * or nothing draftable) arms nothing.
 */
async function fireExpiryTimer(leagueId, deadline) {
  try {
    const outcome = await autoPick({ leagueId });
    if (outcome) armExpiryTimer(leagueId, outcome.pickDeadlineAt);
  } catch (err) {
    // Keep the operator log line and ALSO route to Sentry (#768, ruling 3) so a
    // persistently-throwing autopick on the fast path is visible, not just a
    // line in the worker log. `deadline` is the timer's own armed instant.
    console.error('draft clock timer fire failed for league %s:', leagueId, err.message);
    sentry.captureError(err, {
      leagueId,
      path: 'timer',
      deadlineAt: deadline ?? null,
      ageMs: deadline == null ? null : -msUntilDeadline(deadline),
      ...poolCounters(),
    });
  }
}

/**
 * Sweep entry point (the scheduler's thin caller), demoted to a backstop by the
 * hybrid (ADR 0018). Every ~10s it reads each active, unpaused draft that has a
 * stored deadline and either:
 *   - autopicks it, if the deadline has already elapsed. This is the restart
 *     and lost-timer path: a deadline that passed while the worker was down (or
 *     whose in-process timer was never armed or was dropped) is recovered here
 *     rather than stalling until a timer that does not exist fires.
 *   - arms (or refreshes) an in-process timer for it, if the deadline is still
 *     in the future, so the fast path fires it on time. Re-arming is idempotent.
 * The autopick's committed next deadline is armed at once so the chain does not
 * wait a full poll for its own next pick. The whole sweep is CONTAINED so a
 * thrown query cannot escape into the worker's interval callback and take the
 * draft clock down for minutes (#600); one bad league is caught inside the loop
 * so it cannot abort the others. The leagues table is small, so scanning every
 * active deadline each pass needs no new index (#601).
 */
async function processExpiredPickClocks() {
  const outcomes = [];
  try {
    const active = await pool.query(
      `SELECT "id", "pick_deadline_at" FROM "leagues"
       WHERE "draft_status" = 'active' AND "draft_paused" = false
         AND "pick_deadline_at" IS NOT NULL`
    );
    for (const row of active.rows) {
      if (msUntilDeadline(row.pick_deadline_at) <= 0) {
        // Alarm BEFORE autopicking (#768, ruling 2): a clock overdue past the
        // tolerance raises one Sentry event per episode, then the autopick runs
        // exactly as it does today. A dead worker never reaches here, which is
        // why the API-health detector exists too - this half catches the live
        // worker whose autopick keeps failing.
        alarmIfOverdue(row.id, row.pick_deadline_at);
        try {
          const outcome = await autoPick({ leagueId: row.id });
          if (outcome) {
            outcomes.push({ leagueId: row.id, playerId: outcome.player.id });
            armExpiryTimer(row.id, outcome.pickDeadlineAt);
          }
        } catch (err) {
          // Keep the operator log line and ALSO route to Sentry (#768, ruling 3).
          console.error('auto-pick failed for league %s:', row.id, err.message);
          sentry.captureError(err, {
            leagueId: row.id,
            path: 'sweep',
            deadlineAt: row.pick_deadline_at,
            ageMs: -msUntilDeadline(row.pick_deadline_at),
            ...poolCounters(),
          });
        }
      } else {
        armExpiryTimer(row.id, row.pick_deadline_at);
      }
    }
  } catch (err) {
    // Contain the sweep: log and return what we have so the NEXT interval tick
    // still runs, instead of the rejection escaping to the caller and killing
    // the draft-clock loop (#600). The outer catch has no league in scope, so it
    // routes through captureError with path 'sweep' only (#768, ruling 3).
    console.error('draft clock sweep failed:', err.message);
    sentry.captureError(err, { path: 'sweep', ...poolCounters() });
  }
  return outcomes;
}

module.exports = {
  OVERDUE_AFTER_MS,
  nextPickClockSeconds,
  clockSecondsFor,
  onDraftStarted,
  onPickLanded,
  onPaused,
  onResumed,
  onAutodraftToggled,
  onPickUndone,
  clearClock,
  autoPick,
  processExpiredPickClocks,
  armExpiryTimer,
  fireExpiryTimer,
  cancelAllExpiryTimers,
};
