# Keep League chat and Draft activity separate

Status: accepted (2026-08-26)

The Draft room makes League chat its centerpiece and shows an authoritative
Draft activity stream beside it (spec #429, contract #432). The two look like
one feed to a manager, and the temptation is to make them one thing: write
Draft events into the chat table as system messages, or read chat rows through
the Pick history that Draft events already have. Both would collapse a
privacy boundary and a durability boundary that must stay distinct.

The decision: League chat and Draft activity are separate records with a
shared presentation. League chat is the league-wide, member-only conversation,
authored by managers and carrying Team identity. Draft activity is the
append-only record of authoritative Draft events (Draft start, each Pick,
pause, resume, commissioner correction, reset, completion), authored by the
server from the same transaction as the state change it records. Neither is
stored inside the other. They are ordered into one feed by a per-league
chronology, and a public presenter link receives Draft activity only, never
League chat.

Naming Commissioner correction as part of this contract also resolves a
forward reference the glossary already carried: the Pick entry ends by
deferring to "a separate administrative act", which until now named nothing.

## Why

The two records answer to different rules, and merging them would force one
set of rules onto data that needs the other.

- **Privacy is the sharpest reason.** A presenter link is a public, read-only
  window that must show the live event without exposing member conversation
  (spec user stories 7-9). If Draft events were chat rows, the presenter query
  would filter public events out of a private table and one missed predicate
  would leak conversation. Separate records make the public surface a
  positive selection of the Draft activity record, not a redaction of the
  chat record. Both records carry Team identity and no account identifier, so
  neither ever hands a shared surface an email, username or user ID.
- **Durability differs.** Draft activity must be append-only and must survive
  correction and reset: a correction appends a new entry and never rewrites
  the original Pick entry (see Commissioner correction and Draft activity in
  CONTEXT.md). Chat carries configurable retention and account-deletion
  rules. One table cannot be both permanently append-only and subject to
  retained-content deletion.
- **Authorship differs.** Draft activity snapshots the facts of an event from
  the transaction that commits it, rather than cascading from mutable Pick
  rows, so a later edit or reversal of a Pick cannot silently rewrite what the
  feed recorded happened. Chat is manager-authored free text. Treating either
  as the other loses the property that makes it trustworthy.

## Consequences

- **Separate storage.** League chat messages and Draft activity entries are
  distinct records. Draft activity is written by the server from the same
  transaction as the authoritative state change and snapshots the event's
  facts; it is never a projection of mutable Pick rows and never a chat row.
- **Shared presentation.** The Draft room presents both as one feed. Every
  League-chat message and Draft-activity entry is assigned one transactional,
  per-league chronological position so that all clients, including a
  reconnecting one, reproduce the same order. A public presenter link renders
  Draft activity only; it is given no path to League chat.
- **Legacy cutover.** Surviving chat messages and Picks are backfilled as
  legacy observable facts that preserve their source IDs and timestamps and
  are marked legacy, with equal timestamps ordered deterministically by
  record-type tie-breaker and source ID. An explicit cutover boundary entry
  is inserted after the legacy set to mark where authoritative shared ordering
  begins. Historical pause, resume, correction, reset and autopick facts that
  are absent from stored data are left unstated rather than fabricated.
- **Retention propagation.** Chat retention and account-deletion behavior are
  preserved across the combined feed. When source chat is removed, its feed
  content is removed or redacted and a chronology gap is allowed, rather than
  the feed retaining a copy the chat source has deleted. Draft activity, being
  append-only, is not subject to this deletion.
- **Guarded rollback.** Destructive schema rollback is refused once Draft
  activity exists, because dropping it would erase authoritative append-only
  history. Recovery after that point is a forward migration, or disabling the
  new interface through the short-lived rollout flag, never a destructive
  down-migration. The rollout flag is not exposed as a permanent league
  preference.
- **Migrations are a carve-out.** The storage, backfill and counter
  initialization this decision implies land as migrations that the maintainer
  merges, applies and verifies against `knex_migrations`; an IC writes them
  but does not run them.
