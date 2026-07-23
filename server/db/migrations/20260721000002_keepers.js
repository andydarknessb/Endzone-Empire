/**
 * Keepers: which draft picks a team is spending to retain a player instead of
 * drafting live. draft_round is the *round* the keeper occupies (1-based) —
 * not a pick_number — because the actual pick number depends on draft order
 * (rotation/overrides), which can still change up until the draft starts.
 * draftOrder.service.js's keeperPickNumbers() resolves round -> pick_number
 * at draft-start time, and draftStart.service.js pre-inserts the
 * corresponding draft_picks rows (is_keeper=true) before live picking begins.
 *
 * unique(league_id, player_id): a player can be kept by at most one team.
 * unique(league_id, team_id, draft_round): a team can't spend two keepers on
 * the same round.
 */
exports.up = async function (knex) {
  await knex.schema.createTable('keepers', (t) => {
    t.increments('id').primary();
    t.integer('league_id').notNullable().references('leagues.id').onDelete('CASCADE');
    t.integer('team_id').notNullable().references('teams.id').onDelete('CASCADE');
    t.integer('player_id').notNullable().references('players.id').onDelete('CASCADE');
    t.smallint('draft_round').notNullable();
    t.timestamps(true, true);
    t.unique(['league_id', 'player_id']);
    t.unique(['league_id', 'team_id', 'draft_round']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('keepers');
};
