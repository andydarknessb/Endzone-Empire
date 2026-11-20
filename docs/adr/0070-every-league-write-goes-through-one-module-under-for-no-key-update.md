# Every League write goes through one module, under FOR NO KEY UPDATE

Status: accepted (2026-11-06)

Twenty-nine lock statements in twenty files serialize writes on a League by
locking its row themselves (`SELECT ... FOR UPDATE` on `leagues`), five of
them behind opt-in flags (`forUpdate`, `lock`, `rowLockSettingsProvided`).
Several carry the League, then Team, then Matchup order in a comment, and each fix to one caller came
with its own Postgres test (#946, #962, #2545, #2573). Two pairs can still
deadlock, by reading: a waiver run holds the League and then wants a Team that
a lineup save holds, while the save's insert into `lineup_entries` waits on the
League row; a manual score holds the League and then wants a Matchup that a
Stat correction holds, while the correction's transaction-log insert waits on
the League row. Both waits are the foreign-key check. An insert into any of the
31 tables with a `league_id` foreign key takes `FOR KEY SHARE` on the League
row, and `FOR UPDATE` blocks it.

We decide:

1. **One module owns the League write** (CONTEXT.md, League write). It
   generalizes the Draft act module's `runDraftAct` (#947) and sits beside
   `withTransaction` in `server/modules/`. It is the only code that takes a
   League row lock. It locks the row as its first statement, runs the caller's
   body on the held client, and commits through `withTransaction` (ADR 0033).
   Only then does it run the caller's after-commit work, each piece contained:
   reported once and never rethrown, so a committed write is never reported as
   failed. A caller never writes its own League lock.
2. **The lock is `FOR NO KEY UPDATE`.** It conflicts with itself, so League
   writes still queue behind each other, but it does not block `FOR KEY SHARE`.
   An insert into a `league_id` table therefore never waits on a held League
   write. That removes both deadlock pairs, and a lineup save, the most frequent
   write, never waits on a League write. The audit behind this ruling found about
   25 write paths that insert into those tables without the League lock. None
   depends on the old wait, which only delayed an insert whose values had
   already been read.
3. **A nested League write runs on the held client.** A League write started
   inside another receives the outer write's handle as an explicit parameter.
   The module then takes no lock and opens no transaction, and it queues the
   nested write's after-commit work behind the outer commit. This replaces
   `forUpdate: false`, `proposeTradeWith`'s unlocked re-read and the roster
   gate's no-op re-lock.
4. **Changes confined to one Team stay outside.** A lineup save, the Queue and
   a Called shot declaration are ordered by the Team row lock, not the
   League's. Called shot declaration starts taking that lock, since ADR 0058's
   rule (a save and the shot it contradicts never disagree) depends on it.
5. **CI holds the rule.** A guard fails when server code outside the module
   takes a League row lock, the way the Roster move guard holds roster writes
   (#2535). Account deletion is its one standing exception. It settles the
   departing user's Teams across several Leagues in one transaction and locks
   those rows itself, in id order.

## Why

- **One module, not per-caller locks.** Per-caller locks were the alternative,
  and they are what the code has today. Every new caller re-learns the order
  from a comment, and every fix lands one caller at a time. The Draft act
  module already proved the shape for lifecycle acts: lock first, body on the
  held client, commit, then fan out.
- **The lock mode needs its reason written down.** `FOR UPDATE` is the usual
  way to say "serialize on this row", and a later edit will put it back unless
  the reason sits beside the decision. `FOR NO KEY UPDATE` keeps what the
  League lock is for, two League writes never interleave, and drops only the
  wait both deadlocks need.
- **Nesting is a parameter.** Nothing offers a nested mode today. `runDraftAct`
  has none, so a caller already holding the lock must not call it. The
  scheduled start hands off to `startDraft` before it connects, so the two
  never lock the same row twice, and Draft completion reads the League with
  `forUpdate: false` because it runs inside the Pick's or the Draft start's
  transaction. A handle the caller passes shows in the code and
  in a test which mode ran, where an ambient transaction would hide it.

## Considered and rejected

- **Keep per-caller locks and fix the two pairs.** Each pair is a small fix.
  The next pair would be found the same way: by reading, or in production.
- **Advisory locks keyed by League.** They serialize writers without touching
  the row, but every child insert still takes `FOR KEY SHARE` on the row, and
  a second lock namespace is one more order to keep.

## Consequences

- The opt-in lock flags go. `requireCommissioner` authorizes against the
  League row the write already holds.
- Trade propose, schedule generation (`generateMatchups`), the League-wide
  Roster lock toggle, pick'em settings, a Stat correction and the
  Commissioner's live re-score become League writes. None takes the League
  lock today. A Stat correction then locks the League before its Matchups.
  Trade counter and Advance week's Settle pass already lock the League row
  and move onto the module with the other lockers.
- Chat, reports, read receipts, analytics and recap caches, Trophy awards
  (their own advisory lock) and the kickoff waiver hold (no lock on purpose)
  stay outside.
- Rollout is spec #2681: the lock-mode switch ships first as the deadlock fix,
  then the module, its callers and the guard.

Refs: #2681, #947, #946, #962, #2535, #2545, #2573, ADR 0033, ADR 0058.

## Amendment (2026-11-07, #2694): the scheduled start is a League write of its own

Rule 3's "the scheduled start hands off to `startDraft` before it connects" no longer
describes the code. The scheduled tick's start opens its own League write
(`runStartAction`), and `startDraft` nests inside it through `within`, so a scheduled
start locks the League row once. The reminder and flag actions are League writes too.
The Pick, the nothing-draftable pause and the Draft start are League writes through
`leagueWrite`, not `withTransaction` plus `lockLeague`. The decision above stands.

## Amendment (2026-11-11, #2863): rollover takes the Trophy award's lock inside its League write

This is one exception to the Consequences line that keeps Trophy awards and their advisory lock outside League writes (:90-92), and to the rejected alternative that calls a second lock namespace one more order to keep (:76-78). `rolloverSeason`'s League write takes the award's two-key lock, `lockTwoKeyXact` on `season * 100` plus the week of the latest decided non-consolation playoff game (never a raw `pg_advisory_xact_lock`, ADR 0036). It takes the lock after the League row and before it reads the champion Trophy, so it either reads the Trophy the award committed, or decides first and the award reads `league_history`.

- The order is the League row, then the award key. The award never takes the League row, so there is no cycle.
- A pick'em-only rollover, and a rollover with no decided final, take no lock.
- The wait is blocking and is held to rollover's COMMIT.
- The timeout is the API pool's `statement_timeout`, 15 s (`PG_STATEMENT_TIMEOUT_MS` in `render.yaml`). Advance week and its follow-up run in the API. An award that waits past it is cancelled with SQLSTATE 57014 and rolls back. `awardWeeklyTrophies` then throws, so the final week's high score and season-level trophies, its lineup trophies and the season-complete Called shot judging are skipped, with no retry. The champion Trophy stands, because rollover, having read none, writes it from the final.
- The owner's Ruling on #2852 accepted that wait (https://github.com/andydarknessb/Endzone-Empire/issues/2852#issuecomment-6784928407). Rollover's duration is unmeasured.
