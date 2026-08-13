/**
 * `game_odds_snapshots` — append-only sportsbook quotes, captured as-of.
 *
 * Additive and reversible. No existing table is touched and no existing number
 * changes: `MODEL_CONSTANTS.gameEnvironment.maxEffect` ships 0, so nothing
 * stored here can reach a projection until a sweep raises that cap.
 *
 * WHY A SNAPSHOT TABLE AND NOT A LOOKUP. A game total is not a fact about a
 * game, it is a fact about a MOMENT: a Thursday total of 41 and the 47 the
 * same game closed at are two different measurements, and a provider queried
 * after kickoff may return neither. Storing "the odds" as a single mutable row
 * per game would reproduce precisely the defect `holdout.service.js` was built
 * to eliminate — an evaluation whose inputs have moved since the model spoke,
 * so the numbers being judged are not the numbers the model actually had.
 * Rows here are therefore INSERT-only and carry `observed_at`; a projection
 * run reads the latest snapshot at or before its own `input_cutoff`, which is
 * what makes a stored projection auditable against the "no future information"
 * rule the projection_runs table already enforces for every other input.
 *
 * `game_key` is the same stable both-perspectives identifier `nfl_games` and
 * `game_weather_snapshots` already use (`2026_03_BUF_MIA`, nflverse's own
 * game_id spelling, away-then-home), so one quote covers both team rows of a
 * game exactly as one weather snapshot does.
 *
 * `spread` is the HOME team's line, negative when home is favoured, which is
 * every book's own convention — stored verbatim rather than normalised, so a
 * stored row can be checked against the source that produced it without a
 * sign-convention argument. The two implied team totals are derived at read
 * time by `vegasOdds.provider.impliedTeamPoints`, never stored: deriving them
 * once in code beats storing two columns that can drift out of agreement with
 * the pair that produced them.
 */
exports.up = async function (knex) {
  await knex.schema.createTable('game_odds_snapshots', (t) => {
    t.increments('id').primary();
    t.integer('season').notNullable();
    t.integer('week').notNullable();
    t.string('game_key', 32).notNullable();
    // Provider identifier, stored per row rather than per table: switching
    // feeds mid-season must not make the old rows ambiguous about who said it.
    t.string('source', 40).notNullable();
    // When the QUOTE was observed at the book. Not `created_at` — a backfill
    // inserted on Tuesday can legitimately carry Sunday's observation instant,
    // and conflating the two is how a post-kickoff row would slip into a
    // pre-kickoff read.
    t.timestamp('observed_at', { useTz: true }).notNullable();
    // Both nullable: a book that has posted a total but pulled the spread is a
    // real state, and a half-quote is more honest than a fabricated zero.
    // `gameEnvironmentEffect` returns unavailable unless both are present.
    t.decimal('total', 5, 2);
    t.decimal('spread', 5, 2);
    t.timestamps(true, true);
    // One quote per game per source per instant. A re-fetch that returns an
    // unchanged line is idempotent; a genuine line move is a new row.
    t.unique(['game_key', 'source', 'observed_at']);
    // The read path: newest quote at or before a run's input_cutoff.
    t.index(['season', 'week', 'observed_at']);
    t.index(['game_key', 'observed_at']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('game_odds_snapshots');
};
