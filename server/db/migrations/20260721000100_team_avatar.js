/**
 * Manager avatars (team logos).
 *
 * - avatar_url: public Supabase Storage URL for the team's uploaded photo or
 *   GIF; null = render an initials fallback everywhere (same convention as
 *   players.photo_url).
 * - avatar_static_url: a first-frame PNG rendition, populated only when the
 *   upload was an animated GIF. Lets the UI honor prefers-reduced-motion by
 *   swapping to a static frame without re-deriving one on every render.
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('teams', (t) => {
    t.string('avatar_url', 500);
    t.string('avatar_static_url', 500);
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('teams', (t) => {
    t.dropColumn('avatar_url');
    t.dropColumn('avatar_static_url');
  });
};
