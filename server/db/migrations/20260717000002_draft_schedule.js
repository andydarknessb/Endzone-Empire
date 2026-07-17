/**
 * Scheduled draft start: bookkeeping so the scheduler sends each reminder once
 * and only nags the commissioner once when a scheduled draft can't auto-start.
 * Both reset whenever the draft_date is (re)scheduled — see the league router.
 *
 *   draft_reminder_stage: 0 = none sent, 1 = 24h sent, 2 = 1h sent
 *   draft_autostart_failed: true once the "not enough teams" notice has gone out
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('leagues', (t) => {
    t.smallint('draft_reminder_stage').notNullable().defaultTo(0);
    t.boolean('draft_autostart_failed').notNullable().defaultTo(false);
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('leagues', (t) => {
    t.dropColumn('draft_reminder_stage');
    t.dropColumn('draft_autostart_failed');
  });
};
