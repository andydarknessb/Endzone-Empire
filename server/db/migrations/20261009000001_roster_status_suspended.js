/**
 * `player_nfl_roster_status.roster_status` admits `'suspended'` (#2155, blocks
 * #2150, ruled on #2150 by the owner on 2026-10-09). ESPN's `suspended` roster
 * group becomes its own NFL roster status, `'suspended'`, replacing the
 * `'reserve'` mapping. The daily `espn-roster-status` Sync run will write it, so
 * the CHECK must admit it first.
 *
 * This migration only widens the CHECK from the three values to four. It
 * changes no data and no mapping: the `espnAthleteClient` mapping change is
 * #2150's, and until it lands no row carries the new value.
 *
 * GUARDED down() (ADR 0012): narrowing the CHECK back to `'active'`,
 * `'practice_squad'`, `'reserve'` is refused while any row holds `'suspended'`.
 * Such a row cannot be narrowed without losing the fact that the player is
 * suspended, and remapping it to `'reserve'` is deliberately not done: reserve
 * is informational, suspended is Unavailable (#2150). down() locks the table,
 * counts, and throws naming the table and the count; recovery past that point is
 * a forward migration. Clean on the empty migration-smoke CI database
 * (migrate -> rollback -> migrate).
 *
 * CARVE-OUT (server/db/migrations/**): written by the IC, applied and verified
 * by Cory - never run by the IC. Here it ships via the release preDeploy on
 * Render, which runs `npm --prefix server run migrate`, so it must be on main
 * before or with the #2150 code.
 */

const TABLE = 'player_nfl_roster_status';
const CONSTRAINT = `${TABLE}_roster_status_check`;
const STATUSES = ['active', 'practice_squad', 'reserve', 'suspended'];
const PREVIOUS_STATUSES = ['active', 'practice_squad', 'reserve'];

const inList = (values) => values.map((s) => `'${s}'`).join(', ');

async function swapCheck(knex, values) {
  await knex.raw(`ALTER TABLE "${TABLE}" DROP CONSTRAINT IF EXISTS "${CONSTRAINT}"`);
  await knex.raw(
    `ALTER TABLE "${TABLE}" ADD CONSTRAINT "${CONSTRAINT}" ` +
      `CHECK ("roster_status" IN (${inList(values)}))`
  );
}

exports.up = async function (knex) {
  await swapCheck(knex, STATUSES);
};

exports.down = async function (knex) {
  // Lock before counting so a concurrent Sync INSERT cannot commit between the
  // count and the constraint swap below.
  await knex.raw(`LOCK TABLE "${TABLE}" IN ACCESS EXCLUSIVE MODE`);
  const [{ count }] = await knex(TABLE).where({ roster_status: 'suspended' }).count({ count: '*' });
  if (Number(count) !== 0) {
    throw new Error(
      `Refusing to narrow the roster_status check on "${TABLE}": it holds ${count} ` +
        "row(s) with roster_status 'suspended', which cannot be narrowed to the " +
        'three-value check without losing the fact that the player is suspended ' +
        '(ADR 0012 guarded rollback). Recovery is a forward migration, not a ' +
        'destructive down().'
    );
  }
  await swapCheck(knex, PREVIOUS_STATUSES);
};
