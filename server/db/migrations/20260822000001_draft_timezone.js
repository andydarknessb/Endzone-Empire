/**
 * Shares its timestamp prefix with 20260822000001_fix_draft_rounds_at_start.js
 * (issue #251). The two are order-independent: this file adds
 * leagues.draft_timezone, that one adds and backfills leagues.draft_rounds,
 * and neither reads the other's column. Both are applied everywhere and knex
 * matches applied migrations by filename, so the pair is left as-is and
 * recorded in scripts/migrationPrefixes.js as the one grandfathered
 * duplicate. Do not rename this file, and do not add a third file on this
 * prefix; the migration-prefix guard rejects both.
 *
 * Draft timezone (#116): a nullable IANA timezone stored beside a league's
 * existing draft_date UTC instant. draft_date has always been UTC; this adds
 * the league-owned secondary reference a commissioner selects and confirms so
 * "8pm draft" means the same wall-clock instant no matter which manager reads
 * it, rather than being inferred from any one manager's browser.
 *
 * Every existing row is left null on purpose (#116 AC1): a legacy schedule
 * displays honestly as zone-less/UTC until a commissioner resaves it through
 * the create or settings workflow, which is where the value is validated
 * against the IANA database (Intl.supportedValuesOf('timeZone') in
 * leagueSettings.service.js / discovery.service.js) — not re-derived here.
 * varchar(64) comfortably covers the longest real zone names (e.g.
 * "America/Argentina/ComodRivadavia" is 33 chars).
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('leagues', (t) => {
    t.string('draft_timezone', 64);
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('leagues', (t) => {
    t.dropColumn('draft_timezone');
  });
};
