const { leagueWrite } = require('../modules/leagueWrite');
const { lookupTeam, teamIdentityOf } = require('./teamIdentity');
const { getDraftRoomBroadcast } = require('../modules/draftRoomBroadcast');
const pickClock = require('./pickClock.service');
const draftValidation = require('./draftValidation.service');
const { isLeagueCommissioner } = require('./leagueRole.service');
const { appendLifecycleActivity, appendCorrectionActivity, PAUSE, RESUME, RESET } = require('./draftActivity');
const { teamForPick } = require('./draftOrder.service');
const { draftRosterSize } = require('./rosterShape');
const rosterMove = require('./rosterMove.service');
const { assertRosterWriteAllowed, COMMISSIONER_OVERRIDE, ROSTER_GATE } = require('./rosterGate.service');
const { DraftError } = require('./draftError');

// The board-fact methods a Draft act (CONTEXT.md) may name in its `broadcasts`
// set. runDraftAct validates requested names against this set before COMMIT so a
// typo fails loudly rather than silently in the contained fan-out. The test is
// OWNERSHIP (ADR 0025's amendments): a Draft act owns stateChanged alone;
// rosterChanged retired 2026-11-06, pickLanded and draftCompleted are the Pick
// module's, and scoresUpdated is the scoring service's.
const BOARD_FACTS = new Set(['stateChanged']);

/**
 * The Draft act module (#947, #938, ticket 2697; see CONTEXT.md's Draft act
 * entry). Every Draft lifecycle operation is a named export here, and each runs
 * through runDraftAct. A route validates its input, calls one operation, and maps
 * the result to a status. It never opens a connection, takes the League lock or
 * chooses the fan-out order.
 *
 * The properties runDraftAct pins (draftAct.service.test.js):
 *
 *  1. THE LOCK PRECEDES ANY MUTATION. leagueWrite takes FOR NO KEY UPDATE on the
 *     League row (advancing its board version) as the first statement after
 *     BEGIN, before the body loads Teams, resolves the acting Team, or writes.
 *  2. A THROWN REFUSAL ROLLS BACK AND EMITS NOTHING. Any throw from the body (a
 *     DraftError refusal or a fault) propagates through a ROLLBACK and past the
 *     fan-out, which never runs.
 *  3. THE FAN-OUT RUNS ONLY AFTER COMMIT, in one order: the narration first
 *     (each activity entry through `activityAppended`), then the board facts the
 *     body named. draftFanoutOrder.test.js pins that the Pick clock's escalation
 *     path emits the same pair in the same order.
 *  4. A FAN-OUT FAILURE IS NOT A 500. COMMIT is authoritative (ADR 0025): a room
 *     fan-out failure is reported once and swallowed, and the committed response
 *     is returned anyway.
 *
 * NESTING (#938). A caller already inside a League write does not call
 * runDraftAct: it would take the same League-row lock on a second connection.
 * A nested act runs through leagueWrite's `within` (ADR 0070).
 *
 * The Commissioner correction (correctLatestPick) is NOT a Draft act (CONTEXT.md:
 * administrative act). It is a League write that fans out through the same
 * function, so it still sends its activity entry before stateChanged.
 */
async function runDraftAct({ leagueId, userId }, actBody) {
  // leagueWrite owns connect, BEGIN, the League-row lock, COMMIT-or-guarded-
  // ROLLBACK and the release rule (ADR 0033). The body runs on the held client;
  // the narration-first fan-out is queued as after-commit work.
  return leagueWrite({ leagueId, label: 'draftAct' }, async ({ client, league, afterCommit }) => {
    // INVARIANT: this Teams snapshot takes NO per-row lock, so a body that gates
    // or deletes per Team (reset) is complete for the whole act only because every
    // Team-insert serializes behind this same League lock (joinLeague locks the
    // League row FOR NO KEY UPDATE before its INSERT). server/test/
    // teamInsertLockGuard.test.js guards that (#1043).
    const teamsResult = await client.query(
      `SELECT "id", "owner_id", "autodraft", "draft_position"
         FROM "teams" WHERE "league_id" = $1
        ORDER BY "draft_position" NULLS LAST, "id"`,
      [leagueId]
    );
    const teams = teamsResult.rows;
    // The acting Team, or null. An identity read (never an authorization one): a
    // body that must refuse a non-member does so itself.
    const actingTeam = await lookupTeam(client, { leagueId, userId });
    const outcome = (await actBody({ client, league, teams, actingTeam })) || {};
    const { response, activity = [], broadcasts = [] } = outcome;
    // Validate the requested board-fact names BEFORE commit, so a typo throws onto
    // the rollback path (visible) instead of vanishing into the after-commit
    // containment. Checked against a static allowlist rather than the live adapter
    // on purpose: resolving getDraftRoomBroadcast() here would move the "no
    // transport registered" throw (#765) onto the rollback path too.
    for (const method of broadcasts) {
      if (!BOARD_FACTS.has(method)) {
        throw new Error(
          `draftAct: '${method}' is not a board-fact broadcast (expected one of ${[...BOARD_FACTS].join(', ')}); ` +
            'narration goes through `activity`, not `broadcasts`'
        );
      }
    }
    afterCommit(() => runFanout({ leagueId, activity, broadcasts }));
    return response;
  });
}

/**
 * The one fan-out order (see the module header). Narration first: each activity
 * entry through `activityAppended`, then the named board-fact methods in order.
 * Contained by leagueWrite's after-commit queue: a broadcast failure is reported
 * once, never thrown, and never turns a committed act into a 500.
 */
async function runFanout({ leagueId, activity, broadcasts }) {
  const broadcast = getDraftRoomBroadcast();
  for (const entry of activity) {
    await broadcast.activityAppended(leagueId, entry);
  }
  for (const method of broadcasts) {
    await broadcast[method](leagueId);
  }
}

/** Pause (paused: true) or resume (paused: false) an active Draft. Commissioner only. */
async function setPaused({ leagueId, userId, paused }) {
  return runDraftAct({ leagueId, userId }, async ({ client, league, actingTeam }) => {
    if (!league || league.draft_status !== 'active' ||
        !(await isLeagueCommissioner(client, leagueId, userId))) {
      throw new DraftError(403, 'league not found, not commissioner, or draft not active');
    }
    const result = await client.query(
      `UPDATE "leagues" SET "draft_paused" = $1, "updated_at" = now()
       WHERE "id" = $2 RETURNING "id", "draft_paused"`,
      [paused, leagueId]
    );
    // Clear the clock on pause, arm the policy clock on resume - the Pick clock
    // module is the only writer of the deadline (ADR 0018).
    const pickDeadlineAt = paused
      ? await pickClock.onPaused(client, { leagueId })
      : await pickClock.onResumed(client, { leagueId });
    const entry = await appendLifecycleActivity(client, {
      leagueId,
      kind: paused ? PAUSE : RESUME,
      team: actingTeam,
    });
    return {
      response: { ...result.rows[0], pick_deadline_at: pickDeadlineAt },
      activity: [entry],
      broadcasts: ['stateChanged'],
    };
  });
}

/** Turn autodraft on or off for one Team. The Team's manager or a commissioner. */
async function setAutodraft({ leagueId, userId, teamId, enabled }) {
  return runDraftAct({ leagueId, userId }, async ({ client, league, teams }) => {
    if (!league) throw new DraftError(404, 'league not found');
    const team = teams.find((row) => row.id === teamId);
    if (!team) throw new DraftError(404, 'team not found in this league');
    const isCommissioner = await isLeagueCommissioner(client, leagueId, userId);
    const isTeamManager = team.owner_id === userId;
    if (!isTeamManager && !isCommissioner) {
      throw new DraftError(403, 'only the team manager or a commissioner can change autodraft');
    }
    // An autopick draft makes every pick at once, so Autodraft cannot be switched off there (#2764).
    if (!enabled && league.draft_type === 'autopick') {
      throw new DraftError(409, 'autodraft cannot be turned off in an autopick draft');
    }
    // Turning autodraft off clears any timeout streak.
    await client.query(
      `UPDATE "teams" SET "autodraft" = $1,
              "consecutive_timeouts" = CASE WHEN $1 THEN "consecutive_timeouts" ELSE 0 END,
              "updated_at" = now()
       WHERE "id" = $2`,
      [enabled, teamId]
    );
    // Enabling for the Team on the clock applies the short autodraft delay now.
    if (enabled && league.draft_status === 'active' && !league.draft_paused) {
      const onClock = teamForPick(league.current_pick, teams, {
        rotation: league.draft_rotation,
        overrides: league.draft_order_overrides,
      });
      if (onClock && onClock.id === teamId) {
        await pickClock.onAutodraftToggled(client, { leagueId });
      }
    }
    // No narration: an autodraft toggle appends no Draft-activity entry.
    return {
      response: { leagueId, teamId, autodraft: enabled },
      broadcasts: ['stateChanged'],
    };
  });
}

/**
 * Change the pick clock. It never recomputes the live deadline: it takes effect
 * from the next pick. Commissioner only, while the Draft is pending or active.
 */
async function setClock({ leagueId, userId, pickTimeSeconds }) {
  return runDraftAct({ leagueId, userId }, async ({ client, league }) => {
    if (!league || !['pending', 'active'].includes(league.draft_status) ||
        !(await isLeagueCommissioner(client, leagueId, userId))) {
      throw new DraftError(403, 'league not found, not commissioner, or the draft has already finished');
    }
    await client.query(
      `UPDATE "leagues" SET "pick_time_seconds" = $1, "updated_at" = now() WHERE "id" = $2`,
      [pickTimeSeconds, leagueId]
    );
    return {
      response: { leagueId, pickTimeSeconds },
      broadcasts: ['stateChanged'],
    };
  });
}

/**
 * Reset the Draft to pending: wipe every pick, roster and lineup row made so far.
 * Commissioner only, and refused once any week of the season is settled (#192).
 */
async function reset({ leagueId, userId }) {
  return runDraftAct({ leagueId, userId }, async ({ client, league, teams, actingTeam }) => {
    if (!league || league.draft_status !== 'active' ||
        !(await isLeagueCommissioner(client, leagueId, userId))) {
      throw new DraftError(403, 'league not found, not commissioner, or draft not active');
    }
    // Refuse rather than repair (#192): a reset over settled weeks is a request to
    // invalidate results that already counted. This check runs, and the
    // transaction rolls back, before any DELETE below.
    const finalMatchup = await client.query(
      `SELECT 1 FROM "matchups" WHERE "league_id" = $1 AND "season" = $2 AND "final" = true LIMIT 1`,
      [leagueId, league.current_season]
    );
    if (finalMatchup.rows[0]) {
      throw new DraftError(409, 'the draft cannot be reset because weeks of this season are already settled');
    }
    // The write gate, asked once per Team (#965). Both bypasses are decisions:
    // FREEZE, because a commissioner freeze does not govern a draft-phase roster
    // write, and TEAM_LOCK, because a reset must reach a locked team's roster.
    const wipeTeams = [...teams].sort((a, b) => a.id - b.id);
    for (const team of wipeTeams) {
      await assertRosterWriteAllowed(client, {
        leagueId,
        teamId: team.id,
        direction: 'release',
        playerId: null,
        bypass: [ROSTER_GATE.FREEZE, ROSTER_GATE.TEAM_LOCK],
      });
    }
    await client.query(`DELETE FROM "team_players" WHERE "league_id" = $1`, [leagueId]);
    // The season's lineup rows go with the rosters (#94, user story 13).
    await client.query(
      `DELETE FROM "lineup_entries" WHERE "league_id" = $1 AND "season" = $2`,
      [leagueId, league.current_season]
    );
    await client.query(`DELETE FROM "draft_picks" WHERE "league_id" = $1`, [leagueId]);
    // A CPU-managed Team (owner_id NULL) keeps its Autodraft: nobody is left to turn it back on (#2764).
    await client.query(
      `UPDATE "teams" SET "autodraft" = CASE WHEN "owner_id" IS NULL THEN "autodraft" ELSE false END,
              "draft_ready" = false, "consecutive_timeouts" = 0, "updated_at" = now()
       WHERE "league_id" = $1`,
      [leagueId]
    );
    // draft_date is nulled so the 5-minute scheduler doesn't immediately
    // auto-restart the draft it just reset (#116 clears the zone with it).
    await client.query(
      `UPDATE "leagues"
       SET "draft_status" = 'pending', "current_pick" = 0, "draft_paused" = false,
           "draft_date" = NULL, "draft_timezone" = NULL, "draft_reminder_stage" = 0,
           "draft_autostart_failed" = false, "updated_at" = now()
       WHERE "id" = $1`,
      [leagueId]
    );
    await pickClock.clearClock(client, { leagueId });
    // The reset is an appended fact (#437 AC3): draft_activity is never deleted.
    const entry = await appendLifecycleActivity(client, { leagueId, kind: RESET, team: actingTeam });
    return {
      response: { leagueId, reset: true },
      activity: [entry],
      broadcasts: ['stateChanged'],
    };
  });
}

/** Mark the caller's own Team ready or not ready for a pending Draft. */
async function setReady({ leagueId, userId, ready }) {
  return runDraftAct({ leagueId, userId }, async ({ client, league }) => {
    const refusal = 'not a member of this league, or the draft is not pending';
    if (!league || league.draft_status !== 'pending') throw new DraftError(403, refusal);
    const toggled = await client.query(
      `UPDATE "teams" SET "draft_ready" = $1, "updated_at" = now()
       WHERE "league_id" = $2 AND "owner_id" = $3
       RETURNING "id"`,
      [ready, leagueId, userId]
    );
    if (!toggled.rows[0]) throw new DraftError(403, refusal);
    return {
      response: { leagueId, ready },
      broadcasts: ['stateChanged'],
    };
  });
}

/**
 * Replace the draft order (randomize or an explicit list of Team ids). Commissioner
 * only, while the Draft is pending. Like the keepers save, it fans out nothing.
 */
async function setOrder({ leagueId, userId, order, randomize }) {
  return runDraftAct({ leagueId, userId }, async ({ client, league, teams }) => {
    if (!league || !(await isLeagueCommissioner(client, leagueId, userId))) {
      throw new DraftError(403, 'league not found or you are not the commissioner');
    }
    if (league.draft_status !== 'pending') {
      throw new DraftError(409, 'draft order is locked once the draft starts');
    }
    const teamIds = teams.map((t) => t.id);
    let finalOrder;
    if (randomize) {
      finalOrder = [...teamIds];
      for (let i = finalOrder.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [finalOrder[i], finalOrder[j]] = [finalOrder[j], finalOrder[i]];
      }
    } else {
      const valid = order.length === teamIds.length && teamIds.every((id) => order.includes(id));
      if (!valid) {
        throw new DraftError(400, 'order must contain every team in the league exactly once');
      }
      finalOrder = order;
    }
    for (let i = 0; i < finalOrder.length; i++) {
      await client.query(
        `UPDATE "teams" SET "draft_position" = $1, "updated_at" = now() WHERE "id" = $2`,
        [i + 1, finalOrder[i]]
      );
    }
    return { response: { leagueId, order: finalOrder } };
  });
}

/**
 * Replace the whole keeper list. Commissioner only, while the Draft is pending and
 * before the keeper deadline. Its refusals are DraftErrors; a foreign-key fault
 * (23503) on the INSERT rolls back and reaches the route, which maps it.
 */
async function saveKeepers({ leagueId, userId, keepers }) {
  return runDraftAct({ leagueId, userId }, async ({ client, league, teams }) => {
    if (!league || !(await isLeagueCommissioner(client, leagueId, userId))) {
      throw new DraftError(403, 'league not found or you are not the commissioner');
    }
    if (league.draft_status !== 'pending') {
      throw new DraftError(409, 'keepers can only be edited before the draft starts');
    }
    const lockAt = league.keeper_lock_at || league.draft_date;
    if (lockAt && new Date(lockAt).getTime() <= Date.now()) {
      throw new DraftError(409, 'the keeper deadline has passed');
    }
    const rosterResult = await client.query(
      `SELECT "team_id", "player_id" FROM "team_players" WHERE "league_id" = $1`,
      [leagueId]
    );
    const rosterByTeam = new Map();
    for (const row of rosterResult.rows) {
      if (!rosterByTeam.has(row.team_id)) rosterByTeam.set(row.team_id, new Set());
      rosterByTeam.get(row.team_id).add(row.player_id);
    }
    const normalized = keepers.map((k) => ({ teamId: k.teamId, playerId: k.playerId, round: k.round }));
    const errors = draftValidation.validateKeepers(normalized, {
      teams,
      rosterByTeam,
      keeperCount: league.keeper_count,
      draftRosterSize: draftRosterSize(league),
    });
    if (errors.length > 0) {
      throw new DraftError(400, errors.join('; '));
    }
    await client.query(`DELETE FROM "keepers" WHERE "league_id" = $1`, [leagueId]);
    for (const k of normalized) {
      await client.query(
        `INSERT INTO "keepers" ("league_id", "team_id", "player_id", "draft_round")
         VALUES ($1, $2, $3, $4)`,
        [leagueId, k.teamId, k.playerId, k.round]
      );
    }
    return { response: { leagueId, keepers: normalized.length } };
  });
}

/**
 * True when the Pick being corrected is the Autopick that tripped its Team into
 * Autodraft (#2764): an autopick by a Team now on Autodraft at or past the timeout
 * threshold. No Pick records the trip, so it is inferred from the Team's streak.
 * shortcut: a later Autopick by a Team that already tripped matches too; upgrade:
 * record the tripping Pick.
 */
async function isTrippedAutopick(client, { leagueId, team, pickNumber }) {
  // Lazy: draft.service owns the threshold and loads this module (the pickClock pattern).
  const { shouldAutoEnableAutodraft } = require('./draft.service');
  if (!team.autodraft || !shouldAutoEnableAutodraft(team.consecutive_timeouts)) return false;
  const autopick = await client.query(
    `SELECT 1 FROM "draft_activity" "da"
       JOIN "draft_picks" "dp" ON "dp"."id" = "da"."source_pick_id"
      WHERE "dp"."league_id" = $1 AND "dp"."pick_number" = $2 AND "da"."is_autopick"`,
    [leagueId, pickNumber]
  );
  return autopick.rows.length > 0;
}

const CORRECTION_MESSAGES = {
  NO_PICK_TO_CORRECT: 'there is no live pick to correct yet',
  KEEPER_UNCORRECTABLE: 'a keeper pick cannot be corrected',
  LATEST_PICK_CHANGED: 'the latest pick changed; refresh the draft and try again',
};

/**
 * Commissioner correction (#439): pause an active Draft and reverse ONLY its
 * latest non-keeper Pick as one atomic act, recording the commissioner's reason,
 * and leave the Draft paused (CONTEXT.md: Commissioner correction). It is a League
 * write, not a Draft act, and it fans out in the same narration-first order: its
 * activity entry goes out before stateChanged.
 *
 * `expectedPickNumber` is the Pick the commissioner confirmed; if a newer Pick has
 * landed since, the request is stale (LATEST_PICK_CHANGED). Every refusal is a
 * DraftError with a stable SCREAMING_SNAKE code (ADR 0008); the transaction rolls
 * back on any of them.
 */
async function correctLatestPick({ leagueId, userId, expectedPickNumber = null, reason }) {
  // Validate the reason before opening a transaction (#439 AC4). Trim so
  // whitespace cannot pad the bound.
  const trimmedReason = typeof reason === 'string' ? reason.trim() : '';
  if (trimmedReason.length < 10 || trimmedReason.length > 200) {
    throw new DraftError(400, 'a correction reason of 10 to 200 characters is required', 'CORRECTION_REASON_INVALID');
  }

  return leagueWrite({ leagueId, label: 'correct-pick' }, async ({ client, league, afterCommit }) => {
    if (!league) throw new DraftError(404, 'league not found', 'LEAGUE_NOT_FOUND');
    if (!(await isLeagueCommissioner(client, leagueId, userId))) {
      throw new DraftError(403, 'only the commissioner can correct a pick', 'NOT_COMMISSIONER');
    }
    // A completed Draft's final Pick is not correctable (#439 AC6).
    if (league.draft_status === 'complete') {
      throw new DraftError(409, 'the draft is complete; its final pick is not correctable', 'DRAFT_ALREADY_COMPLETE');
    }
    if (league.draft_status !== 'active') {
      throw new DraftError(409, 'the draft is not active', 'DRAFT_NOT_ACTIVE');
    }

    const teamsResult = await client.query(
      `SELECT "id", "name", "owner_id", "draft_position", "autodraft", "consecutive_timeouts" FROM "teams"
       WHERE "league_id" = $1 ORDER BY "draft_position" NULLS LAST, "id"`,
      [leagueId]
    );
    const teams = teamsResult.rows;
    const picksResult = await client.query(
      `SELECT "pick_number", "team_id", "player_id", "is_keeper" FROM "draft_picks" WHERE "league_id" = $1`,
      [leagueId]
    );

    const { target, code } = draftValidation.correctionTarget(picksResult.rows, league.current_pick, expectedPickNumber);
    if (code) {
      throw new DraftError(409, CORRECTION_MESSAGES[code], code);
    }

    // The reversed Pick's facts, snapshotted onto the correction activity so the
    // append-only feed self-describes what was corrected (#439).
    const playerResult = await client.query(
      `SELECT "id", "name", "position", "nfl_team" FROM "players" WHERE "id" = $1`,
      [target.player_id]
    );
    const player = playerResult.rows[0] || { id: target.player_id, name: null, position: null, nfl_team: null };
    const team = teams.find((tm) => tm.id === target.team_id) || { id: target.team_id, name: null };
    // Read before the Pick row goes: the autopick flag hangs off it (#2764).
    const trippedAutopick = await isTrippedAutopick(client, { leagueId, team, pickNumber: target.pick_number });

    // Reverse exactly the latest non-keeper Pick: its draft_picks row, its roster
    // row, and the lineup rows the Pick benched (#197). A correction runs no gate
    // of its own: it passes the commissioner override and must succeed even during
    // a Roster lock (#2535).
    await client.query(
      `DELETE FROM "draft_picks" WHERE "league_id" = $1 AND "pick_number" = $2`,
      [leagueId, target.pick_number]
    );
    await rosterMove.drop(client, {
      league,
      teamId: target.team_id,
      playerId: target.player_id,
      undoable: false,
      bypass: COMMISSIONER_OVERRIDE,
    });
    // The Autopick that tripped its Team into Autodraft: correcting it clears that Team's
    // Autodraft and streak, the same reset setAutodraft's off-switch makes (#2764).
    if (trippedAutopick) {
      await client.query(
        `UPDATE "teams" SET "autodraft" = false, "consecutive_timeouts" = 0, "updated_at" = now()
         WHERE "id" = $1`,
        [target.team_id]
      );
    }

    // The Draft is LEFT PAUSED with no armed clock: the same team is on the clock
    // again only when a commissioner resumes.
    const newCurrentPick = target.pick_number - 1;
    await client.query(
      `UPDATE "leagues"
       SET "draft_paused" = true, "current_pick" = $2, "pick_deadline_at" = NULL, "updated_at" = now()
       WHERE "id" = $1`,
      [leagueId, newCurrentPick]
    );

    const round = Math.floor((target.pick_number - 1) / teams.length) + 1;
    const activity = await appendCorrectionActivity(client, {
      leagueId,
      team,
      player,
      round,
      pickNumber: target.pick_number,
      reason: trimmedReason,
    });

    // Queued behind the COMMIT, in the same order every act fans out.
    afterCommit(() => runFanout({ leagueId, activity: [activity], broadcasts: ['stateChanged'] }));

    return {
      leagueId,
      pickNumber: target.pick_number,
      ...teamIdentityOf(team),
      player,
      currentPick: newCurrentPick,
      paused: true,
      activity,
    };
  });
}

module.exports = {
  runDraftAct,
  setPaused,
  setAutodraft,
  setClock,
  reset,
  setReady,
  setOrder,
  saveKeepers,
  correctLatestPick,
};
