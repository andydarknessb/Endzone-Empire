# Endzone Empire

A private-league fantasy football app: friends create a league, run a live snake
draft, manage rosters, and play weekly head-to-head matchups scored from real
NFL statistics. Two things sit alongside the game itself and carry their own
vocabulary: the projection engine that advises managers, and the evaluation
apparatus that decides whether that engine is allowed to change.

## Language

### League and membership

**League**:
A private season-long competition a group of friends plays in. When its type
includes fantasy football it owns its own scoring rules, roster shape, schedule
and playoff structure; a pick'em league owns none of those.
_Avoid_: pool, group, room

**League type**:
The create-time, immutable choice of what a league plays: fantasy football,
NFL pick'em, or both. "Both" is a fantasy league with pick'em enabled from the
start, not a third structure; a pick'em league can never grow a fantasy side,
and it always has pick'em on: it is the league's only game, so the commissioner
cannot turn it off (only change how it scores).
After creation the only type fact a league carries is whether it is pick'em-only;
whether a fantasy league plays pick'em is a pick'em setting, one its commissioner
may turn on at any time, so it is never read back as the league's type.
_Avoid_: league kind, mode, format

**Manager**:
A person playing in a league. The human, as opposed to the entity they control.
_Avoid_: owner, member, user (one user account can manage teams in many leagues)

**Team**:
One manager's entry and identity in one league: the entity that appears in
standings, matchups and trophies. It controls a roster only in a fantasy
league; in a pick'em league it is a name and an avatar, nothing more. Teams
rows ARE league membership app-wide, so every league type creates one per
manager. A manager in three leagues has three teams. What a shared surface
may show of that identity is Team identity, a narrower term of its own.
_Avoid_: franchise, squad, roster (the roster is what a team holds, not the team)

**Team identity**:
The Team name and avatar a manager is known by on every surface shared with
other managers: standings, matchups, draft chat, Pick history, readiness and
pick'em. It is the only identity such a surface may ever carry; a manager's
account identifier (email, username) stays confined to their own private
account chrome and is never exposed to another manager. A duplicate Team name
is still valid identity and never a reason to fall back to the account.
_Avoid_: display name, account identity (the thing this replaces), username

**Membership**:
A manager's standing in one league: they are a member exactly when they hold a
team there, and the team is the only record of it. Membership is what every
league-scoped read and write is gated on. It underlies the commissioner role
(a commissioner is always a member, and losing the team loses the role), and
the league's creator always has it.
_Avoid_: access, participation, "having a roster" (a member of a pick'em-only
league holds none)

**Commissioner**:
A manager authorized to administer a league, either its creator or someone the
creator has granted the role. A few powers stay with the creator alone.
_Avoid_: admin, owner, moderator

**League phase**:
Where a league sits in its lifecycle: pre-draft, drafting, in-season, playoffs,
complete. Derived from the league's draft status and season state, never a
field of its own, and it answers league-level questions only: whether a team
may join, whether settings may still change, whether the season is live. The
draft's own turn-by-turn state is draft status, not phase. A pick'em-only
league has no draft and needs its own derivation: it is in-season from the
moment it is created, then complete, and never pre-draft or drafting.
_Avoid_: league status, stage, state

**Draft status**:
Where a draft sits in its own lifecycle: pending (not yet started), active
(picks are being made), complete. Owned and driven by the draft itself, and
read directly by the draft room and the draft engine. It is one input to
league phase, never a substitute for it: "may this pick be made" is a draft
question, "may a team join" is a phase question. A pick'em-only league has no
draft, so its draft status carries no meaning and is never read.
_Avoid_: draft phase, league status

**Joinable**:
A league that will accept a new team right now. A league with a fantasy side is
joinable only while pre-draft; a pick'em-only league is joinable from creation
until its season completes, and again once it rolls into a new season. Derived
from league phase, never stored, and it comes with a reason when it is false
(the draft has started, the season is complete) so the answer can be shown.
Whether one particular manager may join (already a member, league full,
approval required, not public) is a separate question layered on top.
_Avoid_: open (ambiguous with a public league or open slots), recruiting

**League settings**:
What a commissioner can edit about a league: its name, size limits,
roster shape, scoring rules, season and playoff structure, waiver and trade
rules, and draft setup. Each setting answers two independent questions: when it
may still change (draft-frozen or administrative) and whether it exists at all
in a pick'em-only league (fantasy-only or not). Managers read the same thing on
the League Rules page, which is a presentation name, not a second concept.
_Avoid_: configuration, options, preferences, rules (unqualified; "League
Rules" names the page)

**Draft-frozen setting**:
A league setting that can no longer change once the draft starts, because the
draft was run under it: roster shape, scoring rules, season and playoff
structure, size limits and every draft setup setting. League phase owns when
the freeze applies, so a pick'em-only league, which has no draft, never freezes
anything. Managers see the refusal as "locked once the draft starts". Unrelated
to the evaluation apparatus's freeze.
_Avoid_: locked setting (lock already names lineup, roster and keeper locks),
frozen (unqualified, in evaluation contexts)

**Administrative setting**:
A league setting that stays editable all season because nothing already played
depends on it: the league's name, its waiver rules and its trade rules.
_Avoid_: soft setting, mutable setting

**Fantasy-only setting**:
A league setting that configures machinery a pick'em-only league does not have,
so such a league refuses it outright rather than storing it: every setting
except the name and the size limits.
_Avoid_: roster setting (narrower), fantasy setting

**Best ball**:
A league mode in which nobody sets a lineup: each week the best legal lineup a
team could have started is the one that scores.
_Avoid_: auto-lineup

### The NFL layer

**Player**:
A real NFL athlete. Team defenses are carried as players too, so this word
covers both.
_Avoid_: athlete, asset

**DEF**:
A team's defense and special teams, rostered and started as a single player.
_Avoid_: D/ST, defense (ambiguous against both the scoring category and IDP)

**IDP**:
Individual defensive players (DL, LB, DB) rostered as themselves rather than
rolled up into a DEF.
_Avoid_: defensive player

**Slate**:
Every NFL game in one week.
_Avoid_: schedule (the schedule is the whole season), games list

**Kickoff**:
The scheduled start of an NFL game. It is the clock every time-sensitive rule
keys off: lineup locks, pick'em locks and holdout capture deadlines.
_Avoid_: game time, start time

**Bye week**:
A week in which an NFL team does not play, so none of its players can score.
Derived from the season schedule rather than supplied.

**Bye overlap**:
A candidate player sharing a bye week with one or more players already on a
team's roster. It is a neutral roster fact, not a judgment that the overlap is
harmful.
_Avoid_: bye collision, bye conflict

**Injury designation**:
What the injury feed says about a real player's availability: questionable,
doubtful, out, or injured reserve — or nothing, which means healthy. A fact
about the NFL world, written only by the feed sync, never by anything a
manager does in the app. Distinct from the IR slot, which is a place in a
lineup; a player can carry the injured-reserve designation while never
occupying an IR slot, and vice versa is exactly what enforcement exists to
prevent.
_Avoid_: injury status (the column name, not the concept), IR (unqualified —
ambiguous with the slot)

### Draft

**Draft**:
The live event in which teams claim players, under the league's draft type
and draft rotation.

**Draft timezone**:
The nullable IANA timezone a commissioner selects and confirms for a league's
draft, stored beside its UTC instant rather than inferred from any manager's
browser. A legacy schedule with none set displays honestly as UTC. Clearing
the draft date clears the timezone with it, but changing only the timezone
never resets instant-based reminders. Every manager still sees the draft in
their own local time first; the draft timezone is the league's shared
secondary reference, not a replacement for it.
_Avoid_: local time (the viewer's own zone, always shown primary), browser
timezone

**Draft board**:
The team-by-round matrix of committed picks. Pick history is the chronological
view of those same picks, not another draft board.
_Avoid_: pick history, player pool

**Draft type**:
How a league's draft is conducted, chosen before it starts: snake (teams pick
in turn on a clock), auction (teams bid from a salary cap), autopick (every
pick is made by autopick at once, no clock) or offline (the commissioner
records picks made elsewhere, no clock). A draft-frozen setting.
_Avoid_: draft format, draft mode

**Draft rotation**:
The order in which turns come around in a snake, autopick or offline draft:
snake (the order reverses every round) or linear (the same order every round).
An auction has no rotation. A draft-frozen setting.
_Avoid_: order format, draft order (that is which team holds which slot)

**Auction draft**:
The draft type in which teams bid salary-cap dollars for each nominated player
instead of picking in turn. Its settings can be saved, but a live auction
cannot yet be scheduled or started.
_Avoid_: salary-cap draft (fine in copy, not as the term), FAAB (that is a
waiver rule, not a draft)

**On the clock**:
The team whose turn it is to pick, and the timer bounding that turn.
_Avoid_: current picker

**Pick**:
A team's committed claim of one player during a draft. Once accepted it
advances the shared draft state and cannot be undone by the manager who made
it; commissioner correction is a separate administrative act.
_Avoid_: selection, reversible pick

**Autopick**:
The single act of the server making a team's pick when its clock expires: the
first eligible player from that team's queue, otherwise the best available.
_Avoid_: autodraft (that is the standing mode, not the act)

**Autodraft**:
A standing mode a team can be placed in so that every remaining pick is made by
autopick immediately, without waiting out the clock.
_Avoid_: autopick

**Queue**:
A team's private ordered list of the players it wants next. Feeds autopick.
_Avoid_: watchlist, wishlist

**Keeper**:
A player a team carries over from the prior season into the new draft, at the
cost of a draft pick.

**ADP**:
Average draft position: where the wider fantasy market drafts a player. A market
reference, deliberately distinct from this app's own ranking of him.
_Avoid_: rank, position rank

**Draft grade**:
A letter grade assessing a team's completed draft.

**Draft value** (future):
A season-forward assessment of what a player is worth to a drafting team,
weighed against where he is actually going (ADP) and what round remains to
spend. It does not exist yet: no approved season-forward producer backs it,
so no surface may present 17-game pace, ADP or any other historical number as
Draft value until one does. Naming it here reserves the term so a future
producer is not built under a borrowed name.
_Avoid_: value (unqualified), tier, treating 17-game pace or ADP as a stand-in

**Draft Sim**:
A solo practice draft against CPU opponents. It never touches a real league.
_Avoid_: mock draft

### Roster and lineup

**Roster**:
Every player a team holds, starters and bench and IR together.
_Avoid_: lineup

**Lineup**:
The subset of a roster a team starts in one week, one player per starting slot.
_Avoid_: roster, starting roster

**Slot**:
A named place on the lineup card with its own eligibility rule (QB, RB, WR, TE,
FLEX, K, DEF, plus BENCH and IR). Configurable per league. A position is a
property of a player; a slot is a place in a lineup.
_Avoid_: position

**Starting need**:
How many more players at a slot a team still needs to fill its configured
starting lineup, derived live from the league's own starting slots rather than
a fixed roster template. Bench capacity is a separate summary and IR is
excluded, so neither is counted as a starting need.
_Avoid_: roster need, position need

**Draft roster size**:
The number of roster spots a league drafts for: its starters plus its bench.
IR slots are not drafted, so this is the planned round count before a draft
starts and the bound a keeper's round must fit inside.
_Avoid_: roster limit (the IR-inclusive total), roster size (unqualified)

**Draft rounds**:
The number of player-claiming rounds in one draft. A pending draft derives it
from draft roster size; starting the draft snapshots it, and an active or
completed draft never recomputes it from later settings (ADR 0005).
_Avoid_: roster limit, current roster size

**Roster capacity**:
How many players a team may hold right now: its draft roster size, plus one
for each IR-eligible player currently stashed in an IR slot, up to the
league's IR slot count. Capacity is earned by the act of stashing and lost
when the stash empties or its occupant stops being IR-eligible - it is never
a standing entitlement. A commissioner may attest a player IR-eligible when
the feed is wrong, and that attested stash grants capacity like any other.
_Avoid_: roster limit, effective limit

**IR-eligible**:
A player whose current injury designation (out or injured reserve) qualifies
him to occupy an IR slot. Eligibility is a live property of the player, not a
grant to the team: it is checked when a manager places him on IR, and losing
it while stashed is what flags the roster for resolution.
_Avoid_: injured (too broad — questionable and doubtful players are injured
but not IR-eligible), stashable

**Lineup lock**:
The moment a player can no longer be moved into or out of a lineup, namely his
own game's kickoff. In a standard lineup, a manager may still move a
non-IR-eligible player from IR to BENCH to resolve the stash. That exception
does not apply in best ball, where BENCH participates in scoring; every other
move remains locked. Locks are per player, not per week.
_Avoid_: roster lock

**Roster lock**:
A commissioner freeze on one team's roster moves, or on the whole league's.
Unrelated to lineup locks.
_Avoid_: lineup lock

**Free agent**:
An unrostered player who can be added immediately, once waivers have cleared
on him.

**Waiver claim**:
A request for an unrostered player, resolved in a batch rather than
first-come-first-served.

**FAAB**:
Free agent acquisition budget: a fixed season-long budget teams bid from to win
waiver claims. Highest bid wins.
_Avoid_: blind bidding, auction (an auction is a draft type; FAAB is a waiver
rule)

**Waiver priority**:
The reverse-standings order that settles claims in non-FAAB leagues and breaks
ties in FAAB ones. Lower is better.

**Trade**:
A swap of players between two teams, optionally subject to a review window in
which uninvolved managers can vote to veto.

### Scoring and the week

**Matchup**:
One week's head-to-head pairing of two teams in a league.
_Avoid_: game (a game is an NFL game), fixture

**Scoring rules**:
The full set of per-stat point values a league scores by.
_Avoid_: settings, scoring system

**Scoring preset**:
A named starting point for scoring rules that differ only in what a reception is
worth: standard, half PPR, PPR. A league may then customize away from it, so a
preset is a seed and not a description of what a league actually scores. Never
present it as a league's format; describe the live reception value instead.
_Avoid_: scoring format, format

**Scoring profile**:
One of those same three presets used as a fixed identity when one set of players
must be scored several ways at once, as in holdout capture and the backtest. A
profile is never a particular league's rules.
_Avoid_: preset

**Advance week**:
The commissioner action that closes out the current week: finalizes scores,
settles standings, awards trophies and opens the next week.

**Trophy**:
An automatic award written when a week or a season finalizes, such as weekly
high score, champion, longest win streak, biggest comeback or best draft grade.
A pick'em league's season award is the pick'em champion, and a tie makes
co-champions: it is the one trophy written to more than one team at once.
Awarding is idempotent by design.

**Recap**:
A generated narrative summary of one league week.

**Pick'em**:
The pick-the-winners game: every manager picks the winner of every NFL game on
the week's slate. A side game in a fantasy league, or the whole game in a
pick'em league. Independent of rosters and matchups; each pick locks at its
own game's kickoff.

### The projection engine

**Endzone Forecast**:
The name the product gives its projection engine: what managers see on the
advice surfaces. Naming is presentation only - the model version identity
underneath does not change when the name does, and the two are never
interchangeable in evaluation contexts.
_Avoid_: the model (in user-facing copy), Start/Sit Suggestions (superseded
heading)

**17-game pace**:
A league-scoring extrapolation of a player's per-game production from the prior
completed season across seventeen games. It is historical pace, not a forecast,
weekly projection or rest-of-season projection.
_Avoid_: season projection, Season Proj, projected points

**Projection**:
A model's estimate of the fantasy points one player will score in one week. Two
distinct producers exist and their numbers are not interchangeable, so this word
alone is never precise enough.
_Avoid_: prediction, forecast

**Pool projection**:
The older, league-agnostic estimate computed for the whole player pool at once
under default scoring. It backs trades, waivers, public rankings and the Monte
Carlo simulator.
_Avoid_: projection, unqualified

**Weekly projection**:
The current engine's estimate for a named set of players under a specific
league's scoring: recency-weighted production shrunk toward prior-season and
positional baselines, adjusted by capped factors, carrying an interval and a
per-factor explanation.
_Avoid_: projection, unqualified

**Rest of season**:
A third projection horizon covering a player's remaining schedule rather than
one week. Deliberately kept separate from both of the above.

**Factor**:
One named adjustment a weekly projection applies (usage blend, opponent,
head-to-head), each shrunk toward no effect and capped. Factors are what the
explanation exposes to the manager. Another factor, home/away, is built but
permanently gated off and never applies: its activation was abandoned without
evidence (ADR 0001).
_Avoid_: feature, weight, signal

**Model version**:
The identity of the engine's behaviour. Any change to its constants is a new
version, because numbers from two versions are not comparable.
_Avoid_: release, build

**Interval**:
The band around a projection expressing how uncertain it is.
_Avoid_: confidence, margin, error bar

**Start/sit advice**:
The engine's recommendation about which rostered players to start, including an
explicit "too close to call" answer when two players' distributions overlap
enough that no honest edge exists.
_Avoid_: optimal lineup

**Optimizer**:
The assignment routine that fills every starting slot to maximize projected
points. It will leave a slot empty rather than start a negative projection.

### Evaluation

The engine may not change on a hunch, so the vocabulary for proving a change is
warranted is first-class here.

**Holdout ledger**:
The append-only record of what the engine projected before kickoff, captured on
a schedule and physically incapable of being rewritten once outcomes exist. The
one evaluation that cannot be argued with.
_Avoid_: archive, history

**Capture**:
One all-or-nothing write to the holdout ledger, covering one week, one scoring
profile, one model version and every player in the cohort. Partial captures do
not exist, and a late one is labelled as such and is thereby not holdout.
_Avoid_: snapshot

**Capture window**:
The bounded span before kickoff in which a capture counts as holdout. A capture
outside it is late, and thereby not holdout.
_Avoid_: deadline

**Protocol**:
The versioned rules a capture is taken under. Weeks captured under different
protocols are never comparable, and a week captured under the wrong protocol is
permanently lost, not repairable.
_Avoid_: version, unqualified

**Cohort**:
The exact, fingerprinted set of players an evaluation covers, fixed before any
outcome is known. Never "whoever happened to be requested".
_Avoid_: sample, population

**Outcome truth**:
What a player actually scored, reconciled across pinned sources by a rule fixed
in advance. Absence from every source means zero, not missing.
_Avoid_: actuals, results

**Candidate**:
A specific proposed engine change a study exists to judge, named before any
evidence is seen. A candidate failing its gate is a result, not a mistake.
_Avoid_: experiment, proposal

**Backtest**:
The retrospective study asking whether a candidate engine change would have done
better, run against frozen inputs rather than against today's database. Twelve
arms: seven cells and the control (four usage blend weights crossed with
home/away off and on) plus two benchmarks are scored and reach the report; two
identity-assertion arms are generated and never scored.
_Avoid_: replay, simulation

**Snapshot**:
In the backtest, the frozen copy of every external input the study may read,
pinned by digest so that a rerun cannot drift.
_Avoid_: using this word for a holdout capture

**Arm**:
One configuration a study generates projections for. Which arms exist, which
are scored and which may be selected is fixed by the study's own
preregistration.
_Avoid_: variant, treatment, branch

**Identity-assertion arm**:
One of the two generated-but-never-scored arms: a stored-history twin of a
cell, and a control generated independently of the cell that occupies the same
coordinate. Each exists so that an equality the study depends on is checked
against a separately produced run rather than assumed. Reusing a scored cell's
own output as the comparison would prove nothing.
_Avoid_: arm, unqualified

**Sensitivity**:
A non-selecting analysis published beside a candidate to show how its result
moves under a defensible alternative rule. Some sensitivities are arms of their
own; others re-read existing arms' data under a different window or pooling.
It can never select and never veto.
_Avoid_: arm, unqualified (call it a sensitivity arm only when it is one)

**Cell**:
One arm from the family of candidate configurations under study. Use this word
when membership in that family is the point, and "arm" when it is not.

**Control**:
The arm reproducing exactly what production ships today. Every contrast is
against it, and it is never itself selectable.
_Avoid_: baseline

**Benchmark**:
A trivial estimator that no arm may lose to. Benchmarks answer a question
arm-versus-arm contrasts cannot ("is the engine beating nothing at all?") and
are never selectable.
_Avoid_: baseline, control

**Survivor**:
A week captured cleanly and excluded by no rule, so it enters evaluation. The
evaluability floor is the minimum survivor count, fixed in the preregistration,
beneath which the study cannot speak.

**Regret**:
The points a lineup left on the bench: what an arm actually started against what
a perfectly informed manager would have started. The study's primary measure,
because it scores the decision rather than the number.
_Avoid_: error, loss

**Preregistration**:
The written document fixing every rule (metrics, thresholds, exclusions,
tie-breaks) before any number is seen. A rule absent from it cannot be applied
afterwards.
_Avoid_: spec, plan, design doc

**Seal**:
The act that makes a preregistration binding: its final bytes committed and
attested by hash. After the seal a rule can be followed or the study withdrawn,
never amended.
_Avoid_: freeze (a freeze pins code and inputs; a seal binds rules), lock

**Gate**:
A named checkpoint the evaluation must clear before the next stage may run.
Gates are sequential, and clearing an earlier one twice never substitutes for a
later one.
_Avoid_: phase, milestone, stage

**Freeze**:
Pinning the study's code, container image and inputs by digest so that a
stranger can rerun it and get the same bytes back. Unrelated to a draft-frozen
league setting.
_Avoid_: release, tag

**Parsimony**:
The preregistered tie-break that chooses among passing cells by how little each
one changes, never by how well it scored.
_Avoid_: ranking, best
