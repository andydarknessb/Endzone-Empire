/**
 * Phase A of configurable roster construction: starting-slot eligibility
 * (FLEX/SUPERFLEX/DP combos) stops being hardcoded in lineup.service.js and
 * becomes a per-league jsonb array, `roster_slots` — replacing the flat
 * `{QB:1,RB:2,...}` count-only `lineup_slots` map. Also introduces an
 * explicit, capped bench size (today's bench is implicitly "whatever's left
 * of roster_limit", unbounded) and a dp_enabled toggle for individual
 * defensive player slots.
 *
 * Every existing league is backfilled onto the new shape using the same
 * eligibility the app has always hardcoded (SLOT_ELIGIBILITY in
 * lineup.service.js), so existing leagues behave identically after this
 * migration. bench_slots is backfilled from each league's own
 * roster_limit - starters - ir_slots (not just the global default) so a
 * league that had customized roster_limit keeps its effective bench size,
 * clamped into the new 0-5 range.
 *
 * position_caps (draft-time per-position pick caps, draft.service.js) is a
 * separate concern from starting-lineup composition and is untouched here.
 */
const DEFAULT_ROSTER_SLOTS = [
  { key: 'QB', label: 'QB', count: 1, eligiblePositions: ['QB'] },
  { key: 'RB', label: 'RB', count: 2, eligiblePositions: ['RB'] },
  { key: 'WR', label: 'WR', count: 2, eligiblePositions: ['WR'] },
  { key: 'TE', label: 'TE', count: 1, eligiblePositions: ['TE'] },
  { key: 'FLEX', label: 'FLEX', count: 1, eligiblePositions: ['RB', 'WR', 'TE'] },
  { key: 'K', label: 'K', count: 1, eligiblePositions: ['K'] },
  { key: 'DEF', label: 'DEF', count: 1, eligiblePositions: ['DEF'] },
];

// The eligibility half of today's hardcoded SLOT_ELIGIBILITY (lineup.service.js) —
// used only to backfill existing leagues' lineup_slots counts into the new shape.
const LEGACY_ELIGIBILITY = DEFAULT_ROSTER_SLOTS.reduce((acc, s) => {
  acc[s.key] = s.eligiblePositions;
  return acc;
}, {});

exports.up = async function (knex) {
  await knex.schema.alterTable('leagues', (t) => {
    t.jsonb('roster_slots').notNullable().defaultTo(JSON.stringify(DEFAULT_ROSTER_SLOTS));
    t.integer('bench_slots').notNullable().defaultTo(5);
    t.boolean('dp_enabled').notNullable().defaultTo(false);
  });

  const leagues = await knex('leagues').select('id', 'lineup_slots', 'roster_limit', 'ir_slots');
  for (const league of leagues) {
    const counts = league.lineup_slots || {};
    const rosterSlots = Object.keys(LEGACY_ELIGIBILITY)
      .map((key) => ({
        key,
        label: key,
        count: Number.isInteger(counts[key]) ? counts[key] : 0,
        eligiblePositions: LEGACY_ELIGIBILITY[key],
      }))
      .filter((slot) => slot.count > 0 || DEFAULT_ROSTER_SLOTS.some((d) => d.key === slot.key));
    const starters = rosterSlots.reduce((sum, s) => sum + s.count, 0);
    const impliedBench = league.roster_limit - starters - (league.ir_slots || 0);
    const benchSlots = Math.max(0, Math.min(5, Number.isFinite(impliedBench) ? impliedBench : 5));
    await knex('leagues')
      .where('id', league.id)
      .update({ roster_slots: JSON.stringify(rosterSlots), bench_slots: benchSlots });
  }

  await knex.schema.alterTable('leagues', (t) => {
    t.dropColumn('lineup_slots');
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('leagues', (t) => {
    t.jsonb('lineup_slots').notNullable().defaultTo(
      JSON.stringify({ QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1 })
    );
  });

  const leagues = await knex('leagues').select('id', 'roster_slots');
  for (const league of leagues) {
    const flat = (league.roster_slots || []).reduce((acc, slot) => {
      acc[slot.key] = slot.count;
      return acc;
    }, {});
    await knex('leagues').where('id', league.id).update({ lineup_slots: JSON.stringify(flat) });
  }

  await knex.schema.alterTable('leagues', (t) => {
    t.dropColumn('roster_slots');
    t.dropColumn('bench_slots');
    t.dropColumn('dp_enabled');
  });
};
