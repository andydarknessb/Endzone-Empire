# Teams rows are league membership, even without rosters

Status: accepted (2026-08-14)

A pick'em-only league (league type feature, PR 1 of 4) has no draft, rosters,
lineups or matchups, which raises the question of what a member IS there. The
schema has no league-membership table: `teams` is membership, one row per
(league_id, owner_id) since the initial schema. We keep it that way. Every
member of a pick'em-only league gets a teams row at join time, exactly as in a
fantasy league; the row carries their identity (team name and avatar) and
nothing else, because there is no roster to attach.

## Why

Membership rides on `teams` everywhere, and none of it is pick'em-specific:

- `requireMember` in both `pickem.router.js` and `league.router.js` is a
  `SELECT 1 FROM teams WHERE league_id AND owner_id`, and roughly 29 sites
  across the app gate on the same predicate.
- Pick'em standings get their member list AND display identity (team name,
  avatar) from `teams JOIN users` (`getStandings` in `pickem.service.js`).
- Notification fan-out (`notifyLeague`), pick'em reminder digests and
  co-commissioner eligibility (`leagueRole.service.js`) all enumerate members
  via `teams`.
- All four join paths (create, invite code, public join, approve request)
  insert a teams row; the pick'em-only create flow reuses them unchanged.

The alternative, a reified membership table that fantasy leagues would pair
with a roster-bearing team, is the conceptually cleaner model. It was
rejected because it would touch every one of those gates and fan-outs for
zero behavioral difference: nothing pick'em reads from a teams row is
roster-shaped.

## Consequences

- A "team" without a roster is deliberately vestigial. `CONTEXT.md`'s Team
  entry is sharpened to match: a manager's entry and identity in a league,
  controlling a roster only where the league type includes fantasy.
- Members of a pick'em-only league still name a team and set an avatar, and
  every existing membership gate, standings identity, digest and
  co-commissioner path works there unmodified.
- Future features must keep treating a teams row as the membership fact, not
  as evidence a roster exists. Roster-shaped reads against a pick'em-only
  league's teams rows are bugs, and the guard layer (PR 2) is what blocks
  them, not the schema.
