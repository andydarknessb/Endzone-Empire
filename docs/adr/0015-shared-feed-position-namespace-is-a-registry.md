# The shared feed-position namespace is enforced by a registry

Status: accepted (2026-08-27)

ADR 0012 keeps League chat and Draft activity as separate records assigned
"one transactional, per-league chronological position" so every client
reproduces the same feed order. #434 and #435 built that position as a
`feed_seq` on each table, both allocated from one per-league counter
(`league_feed_sequences`). But each table enforced uniqueness only within
itself, through its own `(league_id, feed_seq)` index. The shared namespace was
therefore a convention every writer kept, not a structure the database
guaranteed: PR #470 showed a real Postgres accept a chat row and an activity
row at the same `(league_id, feed_seq)`. #436 must add an explicit
legacy-position write path, which makes that latent collision reachable.

The decision: the per-league position namespace is owned by its own table,
`league_feed_positions`, whose primary key `(league_id, feed_seq)` is the single
place a position is unique across both record kinds. Every chat row and every
Draft-activity row claims its position there through an `AFTER INSERT` trigger,
so a cross-kind duplicate is a primary-key violation that aborts the claiming
transaction. The record tables stay separate under ADR 0012 and keep their own
per-table indexes as defence in depth and to serve the feed reads.

## Why

- **A shared constraint needs a shared object.** Postgres cannot put one unique
  constraint across two tables. Enforcing "one owner per position" without a
  registry would mean trusting every current and future write path to allocate
  correctly, which is the convention that already failed. A registry makes the
  invariant structural, not advisory.
- **The database is the boundary, not any one writer.** Registration lives in a
  trigger for the reason #434 put allocation in one and ADR 0006 put roster
  tenure in one: a fact every write path must maintain holds across a rolling
  deploy only if a caller cannot forget it. `AFTER INSERT` so the row's own
  generated id records who owns the position.
- **The counter cannot lag a reserved position.** Registering a position also
  holds `league_feed_sequences.last_seq` at or above it, so an explicit
  reservation (the #436 path) advances the counter and the next allocation
  continues past it. This is why an explicit chat position and a later activity
  allocation never collide even though chat still permits explicit positions.

## Consequences

- **A reservation contract for #436.** The registry defines what an explicit
  legacy or cutover reservation must supply: league, position, record kind and
  source-record identity. #436 reserves through the same namespace and fails
  atomically on conflict; it does not invent a second enforcement path.
- **Reconciliation before enforcement.** The migration refuses to enforce over a
  feed where any position is already owned by both kinds, naming the collision,
  and backfills existing rows idempotently.
- **Lossless rollback.** The registry mirrors positions the record tables still
  hold, so its own rollback is an unguarded drop and re-derivation, unlike Draft
  activity's guarded rollback (ADR 0012), which protects append-only history.
- **Migrations are a carve-out.** The registry lands as a forward migration the
  maintainer applies and verifies against `knex_migrations`; an IC writes it but
  does not run it. Applied migrations are never rewritten.
