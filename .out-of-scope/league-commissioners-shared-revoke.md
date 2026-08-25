# Shared revoke helper for league_commissioners writes

This repo deliberately keeps its four `league_commissioners` writes inline in
their callers instead of extracting a shared, transaction-scoped revoke
helper.

## Why this is out of scope

The proposal (from #275's review, filed as #315) was a
`revokeGrants(client, { userId })` in `leagueRole.service` that takes the
caller's client, does no authorization check, and sends no notification, so
that `commissioner.service`'s team-removal path, `privacy.service`'s
account-deletion path, and `leagueRole.service`'s own route-facing revoke
could share one statement.

The maintainer ruled the duplication load-bearing (2026-08-25). Each inline
write sits inside a caller that has already authorized in its own way:

- `leagueRole.revokeCoCommissioner` runs `requireOwner` in its own
  transaction, then logs and notifies;
- `commissioner.service`'s team removal runs under its commissioner check;
- `privacy.service`'s account deletion needs no check because the user is
  deleting themselves.

Because each statement is embedded in its authorizing caller, it cannot be
invoked from a context that forgot to check. A shared unchecked helper
creates, for the first time, a call surface that revokes grants with no
policy attached, and its safety would depend on every future caller
remembering to authorize first. This codebase has had several defects of
exactly that shape (a guard prop defaulting to true, a guard relocated below
the work it protected), so the repetition is kept on purpose: it is three
statements standing guard, not three statements of waste.

If a future need genuinely requires a shared write, the ruling implies the
check must travel with it (the helper takes or enforces the policy), not a
bare statement behind a convenient name.

## Prior requests

- #315 - "Four writes to league_commissioners across three services; the revoke helper cannot be used inside a transaction"
