# Endzone Empire

A private-league fantasy football app: friends create a league, run a live snake
draft, manage rosters, and play weekly head-to-head matchups scored from real
NFL statistics. Two things sit alongside the game itself and carry their own
vocabulary: the projection engine that advises managers, and the evaluation
apparatus that decides whether that engine is allowed to change.

## UI conventions

MUI `<Button>` is the house button component; plain `.btn` classes are legacy
(#309).

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
other managers: standings, matchups, League chat, Pick history, readiness and
pick'em. It is the only identity such a surface may ever carry; a manager's
account identifier (email, username) stays confined to their own private
account chrome and is never exposed to another manager. A duplicate Team name
is still valid identity and never a reason to fall back to the account.
Commissioner-only chrome is such a surface too (#179): a commissioner is
another manager, so the co-commissioner roster, the promote and remove-a-team
pickers, Team locks and the join-request queue lead with the Team name and act
on the Team ID, never on a username. A join request has no Team yet, so it is
identified by the Team name it proposes. A non-member reading an invite
preview is further outside still and sees the commissioner's Team name, not
their username (#181). "Which of these is me" is always answered by comparing
Team IDs against the response's viewer-relative field, never by comparing
usernames or user IDs, which #115 removes from every league-shared payload.
Role disclosure is not an exception to this (#324). That a manager holds
commissioner power over you is real, it is not a secret, and every member may
see it; it is disclosed as a property of their Team, and the account behind
that Team is not handed over with the fact. A grant that no longer names a
Team has no identity to disclose and so discloses nothing, which is a
consequence of the rule and not a carve-out from it.
_Avoid_: display name, account identity (the thing this replaces), username

**League chat**:
The league-wide conversation among a league's members, carried wherever they
gather, including the Draft room. It is one conversation, not a separate
Draft-only channel: a message sent from the League Dashboard and one sent from
the Draft room belong to the same League chat. Every message carries Team
identity and no account identifier. League chat is for members only and is
never exposed through a public presenter link, which receives Draft activity
alone. A message over the character limit is refused, never shortened (#502).
_Avoid_: Draft chat (not a separate conversation), public chat, system message
(that is Draft activity)

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
creator has granted the role, a co-commissioner. Two powers stay with the
creator alone: deleting the league, and granting or revoking the role. One
protection stands alongside them: the creator's team cannot be removed by
anyone. Separately, no commissioner of either kind may remove their own team.
_Avoid_: admin, owner, moderator

**Grant**:
The record that a manager holds co-commissioner power in one league. Only the
creator makes one and only the creator revokes one; a grant also ends when its
holder's team is removed or the account is deleted. It is identified by the
Team it names and when it was made, not by the Team alone (Team names may
repeat) and not by the account. A grant whose Team is gone still exists and is
still revocable by a commissioner, but has no identity to show a member and is
invisible to them.
_Avoid_: role assignment, promotion, co-commissioner (the person, not the record)

**League phase**:
Where a league sits in its lifecycle: pre-draft, drafting, in-season, playoffs,
complete. Derived from the league's draft status and season state, never a
field of its own, and it answers league-level questions only: whether a team
may join, whether settings may still change, whether the season is live. The
draft's own turn-by-turn state is draft status, not phase. A pick'em-only
league has no draft and needs its own derivation: it is in-season from the
moment it is created, then complete, and never pre-draft or drafting.
Season operations are a phase rule too: they are unavailable to a league that
is pre-draft or drafting, because there are no rosters yet to schedule or
score. They become available the moment the draft completes, which is also
when the schedule is generated, on the same transaction that completes the
draft.
_Avoid_: league status, stage, state

**Season operations**:
The work a league's season needs once its draft is done: generating the
schedule, scoring each week, and finalizing a week to move the league on.
Grouped under one name because league phase governs all three with a single
rule, and because a pick'em-only league has no draft to wait for and so is
never held back by it.
_Avoid_: season engine (engine is the projection engine), season progression

**Draft status**:
Where a draft sits in its own lifecycle: pending (not yet started), active
(picks are being made), complete. Owned and driven by the draft itself, and
read directly by the Draft room and the draft workflow. It is one input to
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

**Removable**:
A league that will let a team be removed right now. A league with a fantasy
side is removable only while pre-draft, the mirror of joinable: once the draft
has started, its picks, rosters, schedule and lineups are a record that
removing a team would rewrite, so the answer is no and nothing is deleted. A
pick'em-only league has no draft and its teams stay removable. Derived from
league phase, never stored, and it comes with a reason when it is false (the
draft has started) so the disabled control can show it. Whether this
particular team may be removed (a commissioner never removes their own) is a
separate question layered on top.
_Avoid_: deletable, locked, kickable, "can be dropped" (dropping is a roster
move)

**Admission**:
Whether one particular manager may join a joinable league right now: they
are not already a member and the league is not full. The same rule on every
join path, decided at the moment the team is created, never when a request
was filed. How the manager arrived (an invite code, a public listing, an
approved request, creating the league) is their join path, not admission.
_Avoid_: eligibility, permission, joinable (that is the league-level answer)

**Join path**:
One of the four ways a manager comes to hold a team in a league: creating it,
entering an invite code, joining a public league directly, or having a join
request approved. Every path ends in the same act, creating the team, and
differs only in what must be true beforehand (the code matches, the league is
public, a commissioner approved).
_Avoid_: join method, join flow, signup

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
team could have started is the one that scores. Once the week settles, the
pool is the roster held through the week's last kickoff (ADR 0022).
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

**Team code**:
The canonical abbreviation an NFL team is identified by once it has been
folded through `fn_normalize_nfl_team` in SQL or `nflTeam.js` in JavaScript:
WAS for Washington, never WSH. It is the only vocabulary in which two team
columns may be compared or a map may be keyed. The one exception is a pairing
where both sides are known to hold a single writer's raw spelling, and such a
site must say so and name its partner.
_Avoid_: abbreviation, abbr, team (unqualified), nfl_team (the column, whose
contents are raw)

**Raw team code**:
Whatever a team column actually holds before folding, which no column
declares: Tank01's own spelling in `nfl_games` (WSH), a full team name for a
DEF unit in `players` (Washington Commanders), a pre-relocation code in a
historical row (SD, OAK, STL). Raw codes are written and displayed, never
joined on or keyed by. Uniqueness on `nfl_games` is enforced on the team code,
not the raw code (ADR 0011).
_Avoid_: team code (unqualified) when describing what a column contains

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

**Draft room**:
The live page where a league's members follow the Draft and make Picks while
it is running. The Draft board, the player pool, League chat and Draft
activity are panels inside it; the presenter link is a separate public view
of the same Draft, not the room.
_Avoid_: draft board (one panel inside the room), draft page, draft screen

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
_Avoid_: order format, draft order (a term of its own: which team holds which
slot)

**Draft order**:
Which team holds which slot in a draft: the sequence the first round follows,
from which the draft rotation derives every later round. Settled before the
draft starts and unchanged once it has. A manager's upcoming picks are
positions in this order, not a separate thing, and neither is the live
near-term view of it: a panel showing which picks come next is this order
windowed at the current pick, derived and never stored. "Upcoming" is copy
over this concept, not a concept of its own.
_Avoid_: draft rotation (that is how turns come around, snake or linear), pick
order, slot order

**Readiness**:
Which teams have declared themselves ready for a pending draft, counted
against the Teams in the league, not against its configured size: a Team that
has not joined has not declined to be ready, and an empty slot cannot appear
in either list. That the league is not yet full is a separate fact. A fact of
the pending lobby only; it has no meaning once the draft starts. A team that
has not declared is Not ready, and once most teams are ready that group, not
the ready one, is the exception worth naming.
_Avoid_: holdout (Holdout ledger is an Evaluation term), ready status, lobby
status

**Auction draft**:
The draft type in which teams bid salary-cap dollars for each nominated player
instead of picking in turn. Its settings can be saved, but a live auction
cannot yet be scheduled or started.
_Avoid_: salary-cap draft (fine in copy, not as the term), FAAB (that is a
waiver rule, not a draft)

**On the clock**:
The team whose turn it is to pick, and the timer bounding that turn.
_Avoid_: current picker

**Pick clock**:
The timer lifecycle of one turn: armed when a team comes on the clock,
cleared while the draft is paused, and discharged by that team's Pick or by
Autopick when it expires. One rule arms it everywhere, resume included: an
Autodraft team gets the short delay, a timed team gets the full pick time,
an untimed team gets no clock. Pausing forgives elapsed time rather than
preserving it. Repeated consecutive expiries are its consequence too: they
are what places a team into Autodraft.
_Avoid_: countdown (the display), deadline (the stored instant, not the
concept), pick timer

**Overdue**:
A Pick clock whose deadline has passed and which has not been discharged
within the tolerance the server allows itself. Expiry alone is not Overdue;
a clock is normally discharged within moments of expiring. An Overdue clock
is an operational condition for the operator, never a Draft event: it writes
no Draft activity and the room only stops treating the moment as urgent.
_Avoid_: stalled (that is the nothing-draftable pause), stuck, late clock

**Pick**:
A team's committed claim of one player during a draft. Once accepted it
advances the shared draft state and cannot be undone by the manager who made
it; commissioner correction is a separate administrative act. A Pick is made
only while the draft is active: a player added after the draft completes is a
Free agent acquisition, not a Pick, and it is never part of the Draft record.
_Avoid_: selection, reversible pick, free-agent add (a post-draft acquisition,
not a Pick)

**Draft activity**:
The chronological record of consequential shared Draft events: Draft start,
each Pick, pause and resume, and commissioner correction. It is distinct from
League chat and is never authored by a manager. It is append-only through
correction: a correction adds a new entry and never rewrites or erases the
original Pick entry. It is the only Draft-room feed a public presenter link
receives, so it carries Team identity and no account identifier.
_Avoid_: system message, chat message, Pick history (which is Pick-only and
lives in the Draft board)

**Presenter**:
This term carries two senses, numbered below. A reader tells them apart by
what the word describes and never by which directory the file sits in, by
asking one question: is a person looking, or is code wired to it? Sense 1
is a person, or the account-less viewing product a person uses: the
anonymous viewer of a league's Draft through its share link, the presenter
link, board and feed that viewer holds or is shown, a presenter paired with
a member or contrasted with an account holder, and a presenter listed among
the Draft surfaces a viewer watches. Sense 2 is a code role, named by its
position relative to a module: a thin view that fronts a pure module or
hook, a component that consumes a hook's or provider's result, a view that
owns its own render state (clearing an input, drawing a derived value), a
provider that other components reach, and the Draft assistant's per-venue
presenter defined below. When a phrase could read either way, let the far
side of the word decide: a person or an audience there is sense 1, a
module, hook, provider or component there is sense 2. A new comment that
could still be read either way, anywhere in the tree, says "presenter
(sense 1)" or "the share-link presenter", or "presenter (sense 2)" or
"venue presenter", instead of the bare word.

**Sense 1**: An anonymous viewer of a league's Draft through its share link (the presenter
link), holding no account and belonging to no league. A presenter is whoever
holds the link, authorized by the opaque draft share token alone and scoped to
exactly that one league. A presenter sees the read-only Draft board and the
Draft-activity feed (On the clock, the committed Picks and the Draft lifecycle)
and nothing else: never League chat, unread state, a message composer, a
commissioner-hidden tombstone, or any account identity. Team identity is the
only actor identity a presenter is shown. Because a presenter carries no session,
it cannot reach a member route or the Draft socket, so it can neither join the
chat send path nor hold commissioner controls; that refusal is structural, not a
hidden affordance. A commissioner-hidden chat message never sits in a presenter's
feed at all, so a presenter sees no tombstone and no gap where one would be: chat,
hidden or not, is simply absent from the Draft-activity feed the presenter reads.
_Avoid_: spectator, guest, viewer account (a presenter has no account), broadcast
link

**Sense 2**: A thin view that fronts a pure module, the general architectural sense set
out above. Its worked example is the Draft assistant's venue-specific view
that sits between the pure facts builder (a room or Sim `*AssistantFacts`
module) and the pure line generator, `lineFor()`. One presenter engine
exists per venue, the Draft room and the Draft Sim, each mounted once and
sharing one line generator and one polite region; the room realises its
engine as a provider plus thin consumer pieces (a region, a rail panel, a
banner line, a toggle) that share it, while the Sim realises its engine as
one panel component. The presenter owns the trigger decisions common to
both venues: whether a line fires at all, the once-per-turn urgent gate,
the turn-boundary reset, and the selection cooldown; the Queue-snipe check
is the Draft room's alone, since the Sim has no Queue. Once a trigger
fires, the presenter calls the builder to shape the facts object and hands
it to `lineFor()`. The builder shapes the facts; the Sim's builder may
itself decline, returning null when the fact it needs is absent, while the
room's builder always returns a facts object. The line generator owns line
selection, including the per-draft no-repeat pool that keeps a trigger from
reusing a line until its pool is exhausted.
_Avoid_: view component, renderer

**Legacy feed entry**:
A chat message or Pick that existed before the Draft room's combined feed and
was backfilled into it as an observable fact, keeping its original source id and
timestamp and marked legacy. Legacy entries are ordered among each other by one
synthetic per-league chronology: by timestamp, and at an equal instant a Pick
before a chat message, then by source id. What was never recorded (a historical
pause, resume, correction, reset, or whether a Pick was an autopick) is left
unstated, never fabricated. A keeper is NOT a legacy Pick entry: keepers are
pre-filled at draft start rather than committed through the live Pick path, which
writes no Draft activity for them, so the legacy backfill omits them too and a
keeper league's combined feed shows no keeper Picks (they remain in the Draft
board's Pick history).
_Avoid_: imported message, migrated pick (they are legacy facts, not re-authored
ones), backfilled draft (a draft is not an entry)

**Cutover boundary**:
The single per-league marker that separates synthetic legacy ordering from
authoritative live ordering in the combined feed. It sits just after a league's
legacy set; every entry before it is legacy, and every entry after it is a live
event ordered by the shared per-league sequence. It is a Draft-activity entry
but not a Draft event, carries no Team or Pick facts, and is itself never
legacy.
_Avoid_: cutover pick, migration marker, divider (a presentation word, not the
fact)

**Commissioner correction**:
The administrative act by which a commissioner records a reason, then
pauses an active Draft and reverses only its latest non-keeper Pick as one
atomic act, leaving the Draft paused until a commissioner resumes. It is the
separate administrative act the Pick definition refers to: it adds Draft
activity and never erases the original Pick entry, it is not a manager undo,
and it cannot cross a Keeper.
_Avoid_: manager undo, rewind, arbitrary rollback

**Autopick**:
The single act of the server making a team's pick when its clock expires: the
first eligible player from that team's queue, otherwise the best available who
fills a Starting need, otherwise the best available. A kicker or defense is
offered only in the last three rounds, unless the team has no more picks left
than open Starting needs, in which case it fills them, or nothing else remains
to draft. Autopick never refuses to pick because the market is thin; that is a
draft-start concern.
_Avoid_: autodraft (that is the standing mode, not the act)

**Best available**:
The order in which players are offered when nobody has expressed a preference:
by ADP where the market has one, then by last completed season's fantasy
points, then by name. It is the fallback behind autopick and the order of the
draft pool, and it is never the database's own ordering: a player the market
has not ranked but who produced last season comes before one who did neither.
_Avoid_: default rank (a column, and an empty one), top available, BPA

**Draft pool**:
The board a Draft Sim drafts from: every player the market ranks (has an ADP)
or who produced last completed season, in best-available order, plus the IDP
tranche when the template needs it. Membership is that rule, never a count:
a player a mock draft could plausibly reach is in it, and a player in it can
be found by search. The Draft room's available players are the real league's
equivalent and are paged from the whole player table instead.
_Avoid_: player pool, top N, the board (that is the Draft board, committed picks)

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
reference, deliberately distinct from this app's own ranking of him. One market
serves every league: half-PPR, twelve teams, refreshed daily, and a league
cannot start its draft while fewer than a hundred players carry one.
_Avoid_: rank, position rank

**Draft grade**:
A letter grade assessing a team's completed draft. It is earned from Net vs
ADP, z-scored against the rest of the league. Projected roster value is a
separate team stat and is never the grade's input.

**Net vs ADP**:
The sum, across one team's picks, of how far each pick beat its market ADP
(ADP minus pick number, negated so higher is better). A steal is the pick
furthest below its ADP, a reach the pick furthest above it. A market measure
of the draft, not a season-forward one, so it is not Draft value. The Draft
Sim's "Market delta" is the same sum before negation (lower is better there).
_Avoid_: draft value, roster value, steal score

**Draft value**:
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

**Draft assistant**:
A private, opt-in voice in the Draft room and the Draft Sim that comments on
a manager's own Picks, Queue and Pick clock over approved measures (ADP,
steal and reach, Starting need, Autopick). It never ranks, recommends or
alters Best available, presents nothing as Draft value, and is never shown to
a presenter (sense 1, the share-link viewer). "Polk High Legend" is the name
of its first voice, not of the assistant.
_Avoid_: bot, advisor, coach, recommendation engine, commentary feed (Draft
activity is the shared feed; the assistant is private)

### Roster and lineup

**Roster**:
Every player a team holds, starters and bench and IR together.
_Avoid_: lineup

**Lineup**:
The subset of a roster a team starts in one week, one player per starting slot.
_Avoid_: roster, starting roster

**Roster Management presentation**:
The single row presentation every occupied Lineup row uses, whether
Starter, Bench, or IR: profile image, position, Bye, status, and
acquisition detail, plus the row actions player quick view, Trade, Drop,
and Undo. It names a row shape, not a screen: it is distinct from Roster
(everything a team holds) and Lineup (the surface that presents rows in
this shape). The name descends from the Roster Management table Lineup
absorbed and removed (spec #575, ADR 0019); the sentence-case form
'Roster management' survives only as that removed table's historical
accessible name, used in the Lineup test suite's assertion that no such
table remains.
_Avoid_: Roster, Lineup, a separate Roster Management table

**Lineup entry**:
One player's slot on one team's lineup card for one week. A lineup entry
follows the roster: when a team loses a player, his entries for future weeks
are removed, and his current-week entry is removed unless his game has already
kicked off, in which case it stays as the record of the week as played. A week
whose matchup has settled keeps its entries whatever the schedule says about
kickoff: a settled week is scored from those entries alone, so removing one
changes a score the league has already been told. A surviving entry therefore
means the player was on that roster at kickoff, and a starting slot it
occupies is spent for that week: the settle pass will score the surviving row,
so no save, manager or commissioner, may seat a replacement beside it (#627).
Only undoing a drop ever puts
an entry back where it was, and the only slot it puts back is IR: the undo
replays the stash the drop interrupted, and only while that stash is still
valid. Anything else, an undo of a stash that stopped qualifying included,
benches the player like any other acquisition.
_Avoid_: lineup row, stale row

**Tenure**:
One team's continuous holding of one player, from the move that brought him
onto the roster to the move that took him off. A player who leaves and returns
has two tenures. Whether a team held a player at a kickoff is a question about
his tenures, never about his lineup entries.
_Avoid_: membership (a manager's standing in a league), stint, ownership
period

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
from draft roster size; starting the draft fixes it, and an active or
completed draft never recomputes it from later settings (ADR 0005).
_Avoid_: roster limit, current roster size

**Roster capacity**:
How many players a team may hold right now: its draft roster size, plus one
for each IR-eligible player currently stashed in an IR slot, up to the
league's IR slot count. Capacity is earned by the act of stashing and lost
when the stash empties or its occupant stops being IR-eligible - it is never
a standing entitlement. A commissioner may attest a player IR-eligible when
the feed is wrong, and that attested stash grants capacity like any other.
A player a team acquires - by waiver, trade, commissioner add or free agency -
always arrives on the bench and earns nothing; only undoing a drop returns a
player to the stash it interrupted.
_Avoid_: roster limit, effective limit

**IR-eligible**:
A player whose current injury designation (out or injured reserve) qualifies
him to occupy an IR slot. Eligibility is a live property of the player, not a
grant to the team: it is checked when a manager places him on IR, and losing
it while stashed is what flags the roster for resolution.
_Avoid_: injured (too broad — questionable and doubtful players are injured
but not IR-eligible), stashable

**Attested stash**:
An IR stash the commissioner has vouched for because the injury feed is
wrong about its occupant, recorded on the lineup entry by the force-set
path and, when an undoable drop interrupts it, copied onto the dropped
player's waiver hold for the life of that hold so the undo can put it back.
A waiver-claim drop is not undoable and copies nothing. A stash is
**valid** when its occupant is IR-eligible or the entry is attested; a valid
stash grants capacity, is never flagged or nagged, and carries forward across
weeks. The attestation ends the moment the manager makes any slot move on
that player - from that week forward, never retroactively - after which the
normal eligibility gate governs.
_Avoid_: forced stash, override flag

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
One week's head-to-head pairing of two teams in a league. Once a matchup is
final its lineups are a record of the week as played, never a working lineup:
nothing is added to them after the fact, so re-scoring a final week counts
only the players who were there when the games were played.
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

**Score of record**:
The score a week is settled with: written once when the commissioner advances
the week, never recomputed from a later roster, and returned unchanged by every
later re-score of that week.
_Avoid_: final score (a matchup's NFL-style total), official score

**Settle pass**:
The scoring run that produces the score of record. It counts the week's lineup
entries as played and excludes a player unless one of the team's tenures covered
his game's kickoff: began at or before it and had not ended by it. A tenure
that began after kickoff and one that ended before it are both excluded; a
player with no game that week is never excluded. The same predicate governs a
re-score of a final week. In best ball a candidate must also have been held at
the week's last kickoff: a player dropped after his own game but before the
week's last kickoff does not score (ADR 0022). Hindsight reads the same
population (ADR 0023). Distinct from live scoring (the current roster, every
few minutes).
_Avoid_: final scoring, finalize (the step that follows it)

**Advance week**:
The commissioner action that closes out the current week: finalizes scores,
settles standings, awards trophies and opens the next week.

**Expected final**:
A starter's, or a team's, points at the end of the week as best known now: his
weekly projection before his kickoff, his points so far plus any shortfall
against that projection while his game is in progress, and his points alone
once it is final. A team's is the sum over its starters.
_Avoid_: live projection, pace, projected total (once games have started)

**Players remaining**:
The count of a team's starters whose NFL games have not finished this week. A
starter whose game has not kicked off counts.
_Avoid_: PMR (in prose), players left, yet to play

**Hindsight**:
A settled week re-read against the best legal lineup its team could have
started from the week as played, the same players the settle pass read, with
the gap between what it started and that lineup being the points left on the
bench. In best ball the two lineups are one and nothing is ever left (ADR
0023). It is priced under the league's own scoring rules, the same pricer the
settle pass uses, not the stored default-rules `fantasy_points` column (ADR
0024). An IR occupant is never left on the bench: he is not a candidate starter
in any league type, matching the settle pass and the start/sit advisor (#741).
_Avoid_: what-if (the live, in-progress counterpart), regret (the holdout
study's measure of the same gap), optimal lineup (the thing hindsight
compares against, not the comparison)

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

Engine, unqualified, always means this one, here and throughout Evaluation. The
machinery that moves a league through its own lifecycle is named for what it
does instead: draft workflow, pick'em season workflow, live scoring, rollover,
season operations. Only the last has an entry of its own, because it is the
only one that groups things a reader would not otherwise group.

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
