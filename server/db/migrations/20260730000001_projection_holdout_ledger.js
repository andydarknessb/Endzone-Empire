/**
 * The 2026 prospective-holdout ledger: append-only, pre-kickoff projection
 * snapshots the model can be honestly evaluated against once outcomes exist.
 *
 * Why the cache tables cannot serve this purpose: `projection_runs` /
 * `player_week_projections` are MUTABLE by design (regenerated on cache
 * completion, deleted by post-correction invalidation) and traffic-dependent
 * (only requested players get rows). An evaluation ledger needs the opposite
 * properties: cohort-complete, captured before outcomes were knowable, and
 * physically incapable of being rewritten afterwards.
 *
 * 1. `projection_snapshots` — one immutable header per captured
 *    (season, week, scoring profile, model version, capture kind). The
 *    UNIQUE identity is what serializes capture attempts (the writer takes
 *    an advisory lock on it and writes header + every child row in ONE
 *    transaction — see holdout.service). `first_kickoff_at` is the week's
 *    earliest kickoff AS KNOWN AT CAPTURE TIME, and the CHECK constraint is
 *    the database-enforced pre-kickoff cutoff: a capture at or after that
 *    instant must either fail or arrive explicitly labeled `is_late = true`,
 *    which marks it non-holdout. `schedule_games` / `schedule_hash` record
 *    the validated schedule the kickoff was derived from, and
 *    `protocol_version` versions the capture protocol itself so a future
 *    format change cannot masquerade as comparable data.
 *
 * 2. `projection_snapshot_players` — one immutable row per (snapshot,
 *    player) carrying the projection, its factors, and the player's frozen
 *    capture-time context (position, team, injury status, opponent,
 *    orientation, kickoff). Outcomes are NEVER written here: evaluation
 *    joins `player_stats` at read time, so the prediction rows stay exactly
 *    what the model said before kickoff. The BEFORE INSERT trigger is
 *    defense in depth for the cutoff: even a pre-kickoff header cannot
 *    accept child rows once its kickoff has passed, so no partial snapshot
 *    can ever be "completed" late.
 *
 * 3. `fn_reject_holdout_mutation` + triggers — UPDATE, DELETE and TRUNCATE
 *    raise on both ledger tables, for every role including the table owner.
 *    This is what "append-only" means here: not a convention in the service
 *    layer, a property of the schema. Corrections, cache invalidation, and
 *    any future cleanup job hit the same wall.
 *
 * 4. `holdout_capture_status` — deliberately NOT part of the ledger: a
 *    small mutable operational table the worker upserts after every capture
 *    attempt, so completeness and failures survive process restarts and are
 *    readable from the web process's health reporting. No triggers, no
 *    immutability — it records what the pipeline DID, not what the model
 *    SAID.
 *
 * RLS is enabled with no policies (house style for server-only tables): the
 * Supabase client roles cannot touch these tables at all; the server
 * connects as the table owner (verified against production: runtime role
 * `endzone_app` owns migration-created tables) and is subject to the
 * triggers like everyone else.
 *
 * `down()` refuses to drop a NONEMPTY ledger: rolling back a schema is
 * routine, silently destroying captured pre-kickoff evidence is not. The CI
 * migrate/rollback/migrate smoke runs against empty tables and is
 * unaffected.
 */
exports.up = async function (knex) {
  await knex.schema.createTable('projection_snapshots', (t) => {
    t.increments('id').primary();
    t.integer('season').notNullable();
    t.integer('week').notNullable();
    t.string('scoring_profile', 40).notNullable(); // predeclared name: standard | half_ppr | ppr
    t.string('scoring_hash', 64).notNullable();
    t.string('model_version', 64).notNullable();
    t.string('constants_hash', 64).notNullable();
    t.string('release_sha', 64).notNullable(); // required: a capture nobody can attribute is not evidence
    t.string('cohort_hash', 64).notNullable();
    t.integer('cohort_size').notNullable();
    t.integer('schedule_games').notNullable(); // validated game count behind first_kickoff_at
    t.string('schedule_hash', 64).notNullable(); // digest of the week's validated schedule rows
    t.integer('protocol_version').notNullable();
    t.string('capture_kind', 20).notNullable().defaultTo('scheduled'); // scheduled | supplemental
    t.timestamp('captured_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('first_kickoff_at', { useTz: true }).notNullable();
    t.timestamp('input_cutoff', { useTz: true });
    t.boolean('is_late').notNullable().defaultTo(false);
    t.jsonb('source_coverage');
    t.unique(['season', 'week', 'scoring_hash', 'model_version', 'capture_kind']);
    t.index(['season', 'week']);
  });
  // The pre-kickoff cutoff, enforced where the service layer cannot reach:
  // an unlabeled row must have been captured strictly before the week's
  // first kickoff, or the INSERT itself fails.
  await knex.raw(
    `ALTER TABLE "projection_snapshots"
     ADD CONSTRAINT "projection_snapshots_pre_kickoff_check"
     CHECK ("is_late" OR "captured_at" < "first_kickoff_at")`
  );

  await knex.schema.createTable('projection_snapshot_players', (t) => {
    t.increments('id').primary();
    t.integer('snapshot_id').notNullable().references('projection_snapshots.id');
    t.integer('player_id').notNullable().references('players.id');
    t.decimal('mean', 8, 2);
    t.decimal('median', 8, 2);
    t.decimal('p10', 8, 2);
    t.decimal('p25', 8, 2);
    t.decimal('p75', 8, 2);
    t.decimal('p90', 8, 2);
    t.decimal('active_probability', 5, 4);
    t.string('confidence', 12);
    t.integer('sample_size').notNullable().defaultTo(0);
    t.jsonb('factors');
    // Frozen capture-time context. The players/nfl_games tables MOVE (trades,
    // injury updates, schedule syncs); evaluation must see what was true at
    // capture, not what is true at read time.
    t.string('position', 12);
    t.string('nfl_team', 60);
    t.string('injury_status', 40);
    t.string('opponent', 60);
    t.string('home_away', 4);
    t.timestamp('game_kickoff_at', { useTz: true });
    t.unique(['snapshot_id', 'player_id']);
  });

  // Append-only, physically. Row triggers cover UPDATE/DELETE; the statement
  // trigger covers TRUNCATE, which row triggers never see.
  await knex.raw(`
    CREATE OR REPLACE FUNCTION fn_reject_holdout_mutation() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'holdout ledger is append-only: % on % is not allowed', TG_OP, TG_TABLE_NAME;
    END $$ LANGUAGE plpgsql;
  `);
  for (const table of ['projection_snapshots', 'projection_snapshot_players']) {
    await knex.raw(
      `CREATE TRIGGER "${table}_no_mutation"
       BEFORE UPDATE OR DELETE ON "${table}"
       FOR EACH ROW EXECUTE FUNCTION fn_reject_holdout_mutation()`
    );
    await knex.raw(
      `CREATE TRIGGER "${table}_no_truncate"
       BEFORE TRUNCATE ON "${table}"
       FOR EACH STATEMENT EXECUTE FUNCTION fn_reject_holdout_mutation()`
    );
  }

  // Defense in depth for the cutoff, on the CHILD rows: a header written
  // before kickoff must not go on accepting rows after it. Judged by the
  // database clock at insert time, so neither a crashed-and-retried capture
  // nor any future code path can complete a snapshot late.
  await knex.raw(`
    CREATE OR REPLACE FUNCTION fn_reject_late_holdout_child() RETURNS trigger AS $$
    DECLARE
      parent RECORD;
    BEGIN
      SELECT "first_kickoff_at", "is_late" INTO parent
      FROM "projection_snapshots" WHERE "id" = NEW."snapshot_id";
      IF parent IS NULL THEN
        RAISE EXCEPTION 'holdout child row references missing snapshot %', NEW."snapshot_id";
      END IF;
      IF NOT parent."is_late" AND clock_timestamp() >= parent."first_kickoff_at" THEN
        RAISE EXCEPTION 'holdout snapshot % is past its kickoff cutoff; child rows are frozen', NEW."snapshot_id";
      END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql;
  `);
  await knex.raw(
    `CREATE TRIGGER "projection_snapshot_players_pre_kickoff"
     BEFORE INSERT ON "projection_snapshot_players"
     FOR EACH ROW EXECUTE FUNCTION fn_reject_late_holdout_child()`
  );

  // Operational status, NOT ledger: worker upserts every attempt outcome so
  // completeness/failures are durable across restarts and visible to the web
  // process's health reporting.
  await knex.schema.createTable('holdout_capture_status', (t) => {
    t.integer('season').notNullable();
    t.integer('week').notNullable();
    t.string('scoring_profile', 40).notNullable();
    t.string('status', 20).notNullable(); // captured | skipped | failed
    t.text('message');
    t.integer('snapshot_id');
    t.integer('attempts').notNullable().defaultTo(1);
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.primary(['season', 'week', 'scoring_profile']);
  });

  await knex.raw('ALTER TABLE "projection_snapshots" ENABLE ROW LEVEL SECURITY');
  await knex.raw('ALTER TABLE "projection_snapshot_players" ENABLE ROW LEVEL SECURITY');
  await knex.raw('ALTER TABLE "holdout_capture_status" ENABLE ROW LEVEL SECURITY');
};

exports.down = async function (knex) {
  // Refuse to destroy evidence. An empty ledger (the CI smoke, a fresh
  // environment) rolls back freely; captured snapshots do not go away
  // because someone ran a rollback.
  const hasSnapshots = await knex.schema.hasTable('projection_snapshots');
  if (hasSnapshots) {
    const counts = await knex.raw(
      `SELECT (SELECT COUNT(*) FROM "projection_snapshots")::int AS "headers",
              (SELECT COUNT(*) FROM "projection_snapshot_players")::int AS "players"`
    );
    const { headers, players } = counts.rows[0];
    if (headers > 0 || players > 0) {
      throw new Error(
        `refusing to roll back a NONEMPTY holdout ledger (${headers} snapshot(s), ${players} player row(s)); ` +
        'captured pre-kickoff evidence must not be destroyed by a schema rollback'
      );
    }
  }
  await knex.schema.dropTableIfExists('holdout_capture_status');
  await knex.raw('DROP TRIGGER IF EXISTS "projection_snapshot_players_pre_kickoff" ON "projection_snapshot_players"');
  for (const table of ['projection_snapshot_players', 'projection_snapshots']) {
    await knex.raw(`DROP TRIGGER IF EXISTS "${table}_no_mutation" ON "${table}"`);
    await knex.raw(`DROP TRIGGER IF EXISTS "${table}_no_truncate" ON "${table}"`);
  }
  await knex.schema.dropTableIfExists('projection_snapshot_players');
  await knex.schema.dropTableIfExists('projection_snapshots');
  await knex.raw('DROP FUNCTION IF EXISTS fn_reject_late_holdout_child()');
  await knex.raw('DROP FUNCTION IF EXISTS fn_reject_holdout_mutation()');
};
