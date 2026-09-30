# Lineup awards and Called shots are judged once, at Advance week

Status: accepted (2026-09-30)

Spec #1846 came from an outside PRD that asked for a `manager_achievements`
table keyed on (user, week, type), XP per row, a "Tuesday 08:00Z cron" over
"finalized" statistics, and a modal on every swap a manager made against the
engine. Four facts of this domain make each of those wrong here. A week is
final when its commissioner runs Advance week and never on a clock (ADR 0052
already rejected a weekday clock). Trophies are written in the Settle
follow-up's advance mode, keyed on league, season, week, team and type, and
a correction of a final week reconciles only the weekly high score. A Team,
not a user account, is what appears in trophies. And the Start/sit advice is
recomputed live and never saved: a past week's projection run is deleted and
regenerated from current data when anything invalidates it, and the holdout
ledger captures once per week, before the first kickoff, under three preset
scoring profiles, so what the advice said when a manager's players locked
cannot be recovered after the fact.

We decide:

1. Perfect Lineup, Captain Hindsight, Called Shot and the season trophy for
   the fewest points left on the bench are Trophy types, written by the
   weekly award pass at Advance week for teams in that week's Matchups in
   leagues with manager-set lineups. There is no achievements table and no
   XP; a tally is a count of trophies.
2. They are judged once. A later correction never adds, revokes or flips a
   trophy, a Called shot outcome or a stored points-left number; each record
   keeps the numbers it was judged on. The weekly high score stays the one
   trophy a correction reconciles.
3. A Called shot's eligibility is fixed at declaration: it must be made
   against a "Lean start" or "Strong start" suggestion with the Forecast's
   numbers as they then stood, and a later projection change never voids it.
   It is settled at Advance week on the lineup as played and on Appearance:
   void when the lineup no longer reflected it or either player made no
   Appearance, a hit when the starter strictly outscored the benched player,
   a miss otherwise (a tie is a miss).
4. Every other "Lean start" or "Strong start" pair a manager was still
   overriding when the first of its players locked is captured on the
   scheduler tick that first sees that kickoff, with the advice computed as
   of a minute before it, and settled by the same rules. That capture exists
   because nothing else records what the advice said at that moment.
5. A Called shot is the league's to see once both players have locked, miss
   and hit alike; captured overrides are the manager's alone.

Considered and rejected:

- A Tuesday cron. Finality is commissioner-timed (ADR 0052): a clock either
  judges a week that is not final or holds a Thursday advance for days.
- A separate achievements table with XP. Its unique index omitted league and
  season, it had nowhere to hold a pending shot, and XP had nothing to feed;
  trophies already carry the right key and the TrophyCase already shows them
  to the league.
- Reconciling the new trophies on correction, as the weekly high score is.
  A trophy a manager was told about would vanish silently days later, while
  the Recap rebuild and the Postgame cutscene already freeze what was shown;
  storing the judged numbers keeps each record self-consistent instead.
- Judging a Called shot against the advice at kickoff. That needs a
  kickoff-time capture per shot, and calling it before the Forecast comes
  around is the purest form of the feature; declaration is the moment that
  matters for a declared call.
- Recomputing advice after the week from stored runs or the holdout ledger.
  Runs are deleted and regenerated on invalidation, and the ledger's once-a-
  week preset-profile captures judge a Sunday decision by Wednesday's numbers
  under someone else's scoring.
- Automatic overrides only, with no declaration. A stat, not a call; a
  declaration with a visible miss is the stake that makes it a game.
- A modal on every swap against the advice. It fires on 0.3-point gaps and
  interrupts the Lineup page's tap-to-swap flow; the "Too close to call"
  verdict is already the minimum gap, so eligibility needs no other.

Consequences:

- One new table of lineup overrides holds called and captured rows alike,
  with a partial unique index allowing one called row per team-week; the
  migration is its own carve-out cycle with a guarded down and no anon grant.
- The advice builder takes a team's open Called shot and leaves that pair
  out of its suggestions and its move plan, so Apply cannot undo it silently.
- A scheduler-tick capture shaped like kickoff waivers (ADR 0043).
- The Recap narrates the frozen rows and never recomputes them; the
  TrophyCase gains a per-team tally; the Postgame cutscene carries the
  week's awards (ADR 0052, amended).
- This season's already-advanced weeks are backfilled once for Perfect
  Lineup, Captain Hindsight and points left; Called shots and overrides start
  at launch.
- Spec #1846, tickets #1854 to #1864; glossary entries Called shot and
  Override, and the amended Trophy and Hindsight entries.
