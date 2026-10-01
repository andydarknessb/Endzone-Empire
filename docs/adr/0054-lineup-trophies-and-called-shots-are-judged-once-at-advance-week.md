# Lineup trophies and Called shots are judged once, at Advance week

Status: accepted (2026-09-30)

Spec #1846 came from an outside PRD that asked for a `manager_achievements`
table keyed on (user, week, type), XP per row, a "Tuesday 08:00Z cron" over
"finalized" statistics, and a modal on every swap a manager made against the
engine. Four facts of this domain shaped what was decided instead. A week is
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

1. Perfect Lineup, Captain Hindsight and Called Shot are weekly Trophy
   types, written by the weekly award pass at Advance week for teams in that
   week's Matchups in leagues with manager-set lineups. The fewest points
   left on the bench is a season Trophy type, written when the league
   completes, over its settled weeks. There is no achievements table and no
   XP; a tally is a count of trophies.
2. They are judged once. A later correction never adds, revokes or flips a
   trophy, a Called shot outcome or a stored points-left number; each record
   keeps the numbers it was judged on. The weekly high score stays the one
   trophy a correction reconciles.
3. Judging runs before the Recap. The Settle follow-up's advance order
   becomes: power rankings, then trophies awarded with Called shots and
   Overrides settled and every team's points left stored, then the Recap,
   then the digest. The Recap narrates the rows just written and never
   recomputes them, so the announced Recap and the digest carry the new
   lines and a silent rebuild cannot disagree with the trophies; its Bench
   blunder line reads the stored points-left row when one exists.
4. A Called shot's eligibility is fixed at declaration: it must be made
   against a suggestion the advice gives a start/sit probability above the
   tossup line (never "Too close to call", never a pair without a
   probability), with the Forecast's numbers as they then stood, and a later
   projection change never voids it. It is settled at Advance week on the
   lineup as played and on Appearance: void when the lineup no longer
   reflected it or either player made no Appearance, a hit when the starter
   strictly outscored the benched player, a miss otherwise (a tie is a
   miss). A call made against a probability of 0.8 or higher is bold.
5. While a Called shot is open, the advice pins its starter in his slot and
   drops its benched player from the candidates, exactly as it treats locked
   players, so the pair never reappears in the suggestions or the move plan
   and Apply cannot undo the shot silently.
6. Every other suggestion above the tossup line that still stood against
   the manager's lineup when the first of its players locked is an Override,
   captured on the scheduler tick that first sees that kickoff with the
   advice recomputed as of a minute before it, and settled by the same
   rules. That capture exists because nothing else records what the advice
   said at that moment.
7. A Called shot is the league's to see once both players have locked, miss
   and hit alike; Overrides are the manager's alone.

Considered and rejected:

- A Tuesday cron. Finality is commissioner-timed (ADR 0052): a clock either
  judges a week that is not final or holds a Thursday advance for days.
- A separate achievements table with XP. Its unique index omitted league and
  season, it had nowhere to hold a pending shot, and XP had nothing to feed;
  trophies already carry the right key and the TrophyCase already shows them
  to the league.
- Reconciling the new trophies on correction, as the weekly high score is.
  A trophy a manager was told about would vanish silently days later, and
  the Postgame cutscene never replays once seen; storing the judged numbers
  keeps each record self-consistent instead. The Recap rebuild recomputes
  its own facts on a correction, which is exactly why the new lines read
  the frozen rows rather than being recomputed.
- Judging a Called shot against the advice at kickoff. That needs a
  kickoff-time capture per shot, and calling it before the Forecast comes
  around is the purest form of the feature; declaration is the moment that
  matters for a declared call.
- Recomputing advice after the week from stored runs or the holdout ledger.
  Runs are deleted and regenerated on invalidation, and the ledger's once-a-
  week preset-profile captures judge a Sunday decision by Wednesday's numbers
  under someone else's scoring.
- Overrides only, with no declaration. A stat, not a call; a declaration
  with a visible miss is the stake that makes it a game.
- A modal on every swap against the advice. It fires on 0.3-point gaps and
  interrupts the Lineup page's tap-to-swap flow; the tossup line is already
  the minimum gap, so eligibility needs no other.
- Filtering the called pair out of the advice after the fact. One optimal
  assignment produces both the suggestions and the move plan, so removing
  one swap can leave a plan that still benches the starter or starts the
  benched player elsewhere; pinning them the way locked players are pinned
  keeps the plan coherent.

Consequences:

- One new table of lineup overrides holds called and captured rows alike,
  with a partial unique index allowing one called row per team-week; the
  migration is its own carve-out cycle with a guarded down and no anon grant.
- The Settle follow-up's order changes once, for both modes, and the
  glossary's Settle follow-up entry records it.
- A scheduler-tick capture shaped like kickoff waivers (ADR 0043).
- The TrophyCase gains a per-team tally; the Postgame cutscene closes with a
  card naming the week's Trophies and Called shot result (ADR 0052, amended).
- This season's already-advanced weeks are backfilled once for Perfect
  Lineup, Captain Hindsight and points left; Called shots and Overrides start
  at launch.
- Spec #1846, tickets #1854 to #1857 and #1860 to #1864; glossary entries
  Called shot and Override, and the amended Trophy, Hindsight, Settle
  follow-up and Start/sit advice entries.
