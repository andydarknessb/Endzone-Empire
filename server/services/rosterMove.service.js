/**
 * The ONE writer of a single-player Roster move (#2535, spec #2532).
 *
 * A Lineup entry follows the roster (#197). That invariant used to be a step
 * every roster path had to remember, in the right order, beside its own
 * `team_players` write; twelve copies of it, and the order lived in a comment
 * above `placeOnWaiversUndoable` in waiver.service.js. Here the write and the
 * lineup step are one call, in the one order that is correct.
 *
 * `add` and `drop` both take the caller's transaction client. Neither opens a
 * transaction, writes a Transaction log row, places a player on waivers or
 * touches Waiver claims: those are the caller's business, and they differ per
 * path. What the module owns is the roster row, the gate, and the lineup step.
 *
 * The four BULK roster writes are deliberately outside it - the draft reset,
 * the season rollover's two prune statements and the keeper seed at draft
 * start - because they are single league-wide statements with no per-player
 * decision to gate or bench. scripts/check-roster-move-writes.js keeps both
 * lists honest.
 */
const { assertRosterWriteAllowed, DIRECTION } = require('./rosterGate.service');
// Module object, not destructured: the seam tests mock benchAcquiredPlayer.
const lineupService = require('./lineup.service');

/**
 * One player joins one Team's roster: the gate for an acquisition, the roster
 * row, then the lineup step.
 *
 * `stash` is the IR stash an Undo drop is putting back ({ slot, irAttested }),
 * and only an undo ever passes one - he lands on the bench otherwise, because
 * a normal acquisition never returns into an old stash (#94). The caller
 * passes what `interruptedStash` resolved, so "the stash stopped qualifying
 * while he was on waivers" is already a null here.
 *
 * `position` feeds the gate's position cap; a caller that bypasses POSITION_CAP
 * may leave it out.
 */
async function add(client, { league, teamId, playerId, position, stash = null, bypass }) {
  await assertRosterWriteAllowed(client, {
    leagueId: league.id,
    teamId,
    direction: DIRECTION.ACQUIRE,
    playerId,
    position,
    bypass,
  });
  await client.query(
    `INSERT INTO "team_players" ("league_id", "team_id", "player_id") VALUES ($1, $2, $3)`,
    [league.id, teamId, playerId]
  );
  if (stash) {
    await lineupService.restoreInterruptedStash(client, {
      league, teamId, playerId, slot: stash.slot, irAttested: stash.irAttested,
    });
  } else {
    await lineupService.benchAcquiredPlayer(client, { league, teamId, playerId });
  }
}

/**
 * One player leaves one Team's roster: the gate for a release, the roster row,
 * then the lineup entries that go with it (a kicked-off current-week entry
 * stays, as the record of the week as played).
 *
 * Returns `{ stash, removed }`. `stash` is what the drop interrupted, read
 * BEFORE the entries are removed - the row will not be there to read after -
 * and only when the drop is undoable; a waiver-claim drop is not, and records
 * nothing. It is the waiver hold's interrupted-stash fields, so Waivers (which
 * owns placement) writes the hold from it and no longer needs its own ordering.
 * `removed` is the roster rows deleted, so each caller keeps its own "he is not
 * on that roster" copy.
 */
async function drop(client, { league, teamId, playerId, undoable, bypass }) {
  await assertRosterWriteAllowed(client, {
    leagueId: league.id,
    teamId,
    direction: DIRECTION.RELEASE,
    playerId,
    bypass,
  });
  const entry = undoable
    ? await lineupService.currentWeekEntry(client, { league, teamId, playerId })
    : null;
  const deleted = await client.query(
    `DELETE FROM "team_players" WHERE "team_id" = $1 AND "player_id" = $2 RETURNING "id"`,
    [teamId, playerId]
  );
  if (deleted.rowCount === 0) return { stash: null, removed: 0 };
  await lineupService.removeLineupEntries(client, { league, teamId, playerId });
  return {
    stash: entry ? { slot: entry.slot, irAttested: Boolean(entry.ir_attested) } : null,
    removed: deleted.rowCount,
  };
}

module.exports = { add, drop };
