# Play-select replaces the dash island's look on league pages

Status: accepted (2026-10-15)

ADR 0020 scoped the `dash-*` token group, Barlow Condensed and Archivo to the
League Dashboard island, and ADR 0031, ADR 0037, ADR 0038, ADR 0049 and
ADR 0051 brought Game Center, Matchup Detail, Lineup, Pick'em, Waivers and
Home in after it. On 2026-10-15 Home left that look: #2315 shipped it as the
Play-select screen (the `home-*` tokens, Press Start 2P for display, 6px
double-rule frames, one cursor), an owner decision recorded only in
DESIGN.md's "Home surface" section. Every league card on Home now leads from a
Tecmo play-select screen into a Commissioner's Desk page, so the two looks meet
on every click into a league.

The owner chose to carry Play-select to every league page (shape brief and
design canvas https://claude.ai/artifact/PrJq3Dhr94dkYbkG4hw2Vj, version 12,
working files in `docs/design/league/`). The canvas draws the League Dashboard
in every phase and league type (pre-draft, drafting, in season, game day with a
lock under an hour, game day with nothing due, complete, pick'em-only), phone
boards, a States sheet, the league kit, and one sample per later wave
(Matchup, Lineup, the Draft room wide and narrow, the Commissioner console). It
went through two QA passes and four critique rounds before approval.

We decide:

1. **One look for Home and every `/league/:leagueId/*` route.** Play-select
   replaces the `dash-*` look on the island pages and the app-token look on the
   league pages still outside the island (Draft room, Draft settings, League
   rules, Trade center, Transaction log, Power rankings). Only the visual layer
   changes: the Feature-Sliced Design structure of ADR 0017, 0020, 0029 and
   0031 (slices, layers, import rules) stays as it is.
2. **One token group, renamed once.** The `home-*` tokens become `ps-*`
   (play-select) in the first wave, in one rename across `tokens.js`,
   `tokens.contrast.test.js` and every consumer, before any league page uses
   them. League pieces add `ps-*` tokens with their contrast pairs; no league
   page reads a `home-*` or `dash-*` token after its wave ships.
3. **Five waves, one PR each**, in this order, because each later wave reuses
   pieces the earlier one builds: (1) the League Dashboard; (2) Matchup, Game
   Center and Pick'em; (3) Lineup, Waivers and Trades; (4) the Draft room and
   the Draft presenter, gated by `tests/e2e/draft-accessibility.spec.ts`, whose
   roles and names the canvas keeps; (5) the Commissioner console, Draft
   settings, League rules, League history, Transaction log and Power rankings.
   The `dash-*` group and its contrast pairs are deleted in wave 5, once no
   file under `src/` reads them.
4. **What stays outside it.** The app shell (Nav, Footer) keeps the app
   tokens on every route. Game Center's amber LED retro scoreboard stays amber
   on black. The public mock draft (`DraftSim`), `/league` and `/league/join`
   are not league pages and are unchanged. Home's Create and Join dialogs keep
   their current styling until a Home ticket takes them.
5. **Rules carried from Home, plus the league ones.** One cursor per page, on
   the viewer's next move in that league, and none when nothing needs the
   viewer; one filled action per page outside a modal; green only for that
   action and live state; red only for a lock under an hour, a draft clock
   under 30 seconds, and errors. Position tags are data encodings and are
   exempt from the red and green rules. Pixel type only at 16, 24 and 32 and
   never on a sentence. Containers come in three tiers: Board black for live,
   the 6px double rule for primary frames, a 2px rule for tertiary ones.
   Buttons are 44px, except inside dense desktop tables, where 36px is allowed.

Consequences:

- The canvas is the spec for every wave; DESIGN.md's "Play-select" section is
  its written form, and each wave's spec issue cites the boards it builds.
- Wave 1 carries the token rename, so it touches Home's files as well as the
  dashboard's. Waves 2 to 5 touch only their own pages and any `ps-*` pieces
  they add.
- Until wave 5 ships, the app has three looks at once (Play-select, the dash
  island, legacy). Each wave's PR states which routes it moved.
- Some canvas pieces need data the dashboard does not read today (the viewer's
  pick'em row on a fantasy dashboard, the suggested swap behind the lead card's
  note). The wave specs list each one as a data gap or a scoped read, never as
  invented copy.

## Amendment (2026-10-20, spec #2453): the carve-outs move too, then the dash group goes

Decision 3 deletes the `dash-*` group once no file under `src/` reads it,
and decision 4 kept some surfaces out of the move. With waves 4 and 5
specced (#2432, #2433), the only readers left sit outside
`/league/:leagueId/*`: Home's Create league and Join league dialogs, the
Players page (`/player`) and the player card it opens, the player card on
the player profile, and default components in TrophyCase and RecapCard
that nothing renders. The two decisions could not both hold.

The owner chose to move those readers as well:

1. Home's Create league and Join league dialogs move to Play-select. This
   is the Home ticket decision 4 waited for.
2. The Players page moves to Play-select, and the player card opens in the
   Play-select look everywhere, the public player profile included. The
   card is a drawer or sheet over its page, so it is its own surface.
3. Each shared slice's `look` option is removed once every caller passes
   Play-select. The draft schedule field keeps its option, because
   `/league` still renders it in the legacy look.
4. Then the `dash-*` group, its contrast pairs, the dash `shared/ui`
   pieces and Barlow Condensed are deleted. Archivo stays as the
   Play-select body face.

Decision 4 now covers only these: the app shell (Nav, Footer) keeps the
app tokens on every route; Game Center's amber LED stays amber on black;
the public mock draft (`DraftSim`), `/league` and `/league/join` keep the
legacy app look. None of them reads the `dash-*` group.
