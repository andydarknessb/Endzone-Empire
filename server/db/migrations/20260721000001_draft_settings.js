/**
 * Draft Settings feature — data model for commissioner-configurable draft
 * type, scheduling, order/rotation, auction (settings only — no live auction
 * engine yet), keepers, and presenter mode.
 *
 * - draft_type: which engine runs the draft. 'snake' is today's only
 *   behavior and stays the default so every existing league is unaffected.
 *   'auction' is accepted as a *setting* but draftStart.service.js refuses to
 *   start one (501) until a live auction engine ships — see draftValidation
 *   .service.js's startPlan().
 * - draft_rotation: 'snake' (last pick of a round picks first next round,
 *   today's only behavior) vs 'linear' (same order every round). Read by
 *   draftOrder.service.js's teamForPick(), which replaces the inline
 *   round-parity math in draft.service.js's teamIndexForPick().
 * - draft_order_overrides: optional per-round manual order, e.g.
 *   {"3": [teamId, teamId, ...]} (1-based round keys). A round with no entry
 *   falls back to draft_rotation. Validated against live team ids at both
 *   save time (league.router.js) and draft start time (stale-team guard in
 *   startPlan()) since teams can join/leave between the two.
 * - auction_settings: jsonb blob (budget/timers/nomination order) — only
 *   meaningful when draft_type='auction', mirroring how scoring_rules is
 *   only meaningful for the categories it names. No dedicated columns since
 *   the shape is single-purpose and may grow with the future auction engine.
 * - keepers_enabled/keeper_count/keeper_lock_at: flat columns (matches the
 *   waiver- and trade-settings precedent for simple scalar league config).
 *   A null keeper_lock_at means "locks whenever draft_date does".
 * - draft_share_token: opaque token for the public, unauthenticated
 *   presenter-mode board (GET /api/draft/board/:token). Null until the
 *   commissioner generates one.
 * - teams.draft_ready: per-team "I'm set for the live draft" checkbox,
 *   surfaced in the readiness checklist.
 * - draft_picks.is_keeper: marks picks pre-inserted from the keepers table at
 *   draft start, so undo (draft.router.js POST /undo) refuses to cross them
 *   and the board can badge them distinctly from picks made live.
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('leagues', (t) => {
    t.enu('draft_type', ['snake', 'auction', 'autopick', 'offline'], {
      useNative: true,
      enumName: 'draft_type',
    }).notNullable().defaultTo('snake');
    t.enu('draft_rotation', ['snake', 'linear'], {
      useNative: true,
      enumName: 'draft_rotation_type',
    }).notNullable().defaultTo('snake');
    t.jsonb('draft_order_overrides');
    t.jsonb('auction_settings');
    t.boolean('keepers_enabled').notNullable().defaultTo(false);
    t.smallint('keeper_count').notNullable().defaultTo(0);
    t.timestamp('keeper_lock_at', { useTz: true });
    t.text('draft_share_token').unique();
  });

  await knex.schema.alterTable('teams', (t) => {
    t.boolean('draft_ready').notNullable().defaultTo(false);
  });

  await knex.schema.alterTable('draft_picks', (t) => {
    t.boolean('is_keeper').notNullable().defaultTo(false);
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('draft_picks', (t) => {
    t.dropColumn('is_keeper');
  });

  await knex.schema.alterTable('teams', (t) => {
    t.dropColumn('draft_ready');
  });

  await knex.schema.alterTable('leagues', (t) => {
    t.dropColumn('draft_type');
    t.dropColumn('draft_rotation');
    t.dropColumn('draft_order_overrides');
    t.dropColumn('auction_settings');
    t.dropColumn('keepers_enabled');
    t.dropColumn('keeper_count');
    t.dropColumn('keeper_lock_at');
    t.dropColumn('draft_share_token');
  });

  await knex.raw('DROP TYPE IF EXISTS "draft_type"');
  await knex.raw('DROP TYPE IF EXISTS "draft_rotation_type"');
};
