/**
 * data_sync_runs: an observable record of when a background data-sync job ran,
 * whether it succeeded, and a small free-form detail blob (#747).
 *
 * WHY IT EXISTS. players.adp was refreshed only by a hand-pressed admin button,
 * with nothing recording that it ran. When the market is empty league-wide,
 * Best available silently degrades to last season's points with no error and no
 * log. This table is the observable fact the ADP job now writes on every run:
 * the daily worker sync and the manual admin trigger both append a row, and the
 * scheduler-status read (getSchedulerStatus -> health + admin payloads) reports
 * the latest one. The market gate on draft start reads players.adp directly, not
 * this table. The freshness signal (MARKET_STALE_DAYS) is surfaced by a sibling
 * UI ticket and does not read this table yet.
 *
 * WHY GENERIC (job text), NOT adp-specific. Decision 3 of the grill: the columns
 * are deliberately job-agnostic so a later sync (injuries, schedule, photos) can
 * reuse the same table by writing its own `job` value. Only the ADP job writes
 * it today.
 *
 * WHY detail IS jsonb. Each job carries a different handful of numbers - the ADP
 * job records { adpPlayers, matched } on success and { reason, adpPlayers } when
 * the wipe guard trips - so a typed column per number would bloat the table for
 * every future job. The scheduler-status read selects finished_at, ok and detail,
 * reading detail.matched out of the blob.
 *
 * WHY down() PLAINLY DROPS. Unlike draft_activity, this table holds no
 * append-only user history whose loss is irrecoverable: it is an operational log
 * that any later run reconstructs going forward. So the rollback is a clean drop,
 * and the migrate/rollback/migrate smoke gate passes without a guard.
 *
 * MIGRATIONS ARE A CARVE-OUT (fleet): written here, applied and verified against
 * knex_migrations by the maintainer, in its own batch. An IC does not run it.
 */

const TABLE = 'data_sync_runs';

exports.up = async function (knex) {
  await knex.schema.createTable(TABLE, (t) => {
    t.increments('id').primary();
    // The job discriminator (e.g. 'adp'). Free text, no enum: a new job type is
    // a new string, not a migration.
    t.string('job', 64).notNullable();
    // When the run began and finished. started_at is supplied by the caller (the
    // instant it captured before the upstream fetch); finished_at is left to this
    // DEFAULT (the recorder omits the column), so one INSERT at the end of a run
    // stamps it with the write instant.
    t.timestamp('started_at', { useTz: true }).notNullable();
    t.timestamp('finished_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    // Whether the run did its job. A thin upstream response that would have
    // wiped the market is recorded ok = false with nothing written to players.
    t.boolean('ok').notNullable();
    // Per-job free-form counters/reason. Nullable: a job may record nothing.
    t.jsonb('detail');
  });

  // The scheduler-status read wants the latest row for a job:
  // WHERE job = $1 ORDER BY finished_at DESC, id DESC LIMIT 1. This index serves
  // the (job, finished_at DESC) scan; the id tiebreak, for the rare case of two
  // rows sharing a finished_at, is a trivial sort within that one matching group
  // at LIMIT 1 and needs no coverage of its own.
  await knex.raw(
    `CREATE INDEX "data_sync_runs_job_finished_at"
     ON "${TABLE}" ("job", "finished_at" DESC)`
  );

  // Defense in depth on the shared Supabase project, mirroring draft_activity
  // and roster_tenures (#240): the app connects as the table owner and bypasses
  // RLS, so enabling it costs nothing here while denying anon / authenticated
  // PostgREST access by default.
  await knex.raw(`ALTER TABLE "${TABLE}" ENABLE ROW LEVEL SECURITY`);
};

exports.down = async function (knex) {
  // Operational log, not append-only history: a clean drop (the index goes with
  // the table).
  await knex.schema.dropTableIfExists(TABLE);
};
