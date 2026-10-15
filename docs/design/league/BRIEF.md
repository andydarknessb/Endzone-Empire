# Brief: Play-select across the league (confirmed 2026-10-15)

1. Job and audience: managers and commissioners inside one league on the weekly rhythm. Operate mode; no screen slower to scan than its desk version.
2. Outcome and proof: Home to league is one game (same field, frames, pixel type, cursor). Each league page's cursor sits on the viewer's next move. Proof: each wave passes existing e2e and contrast suites, both themes, phone and desktop.
3. Direction: extend the shipped Play-select world (DESIGN.md "Home surface") into a league kit. Press Start 2P at 16/24/32 for headings, scores, team names in heads; Archivo at desk density for rows, feeds, chat, forms, sentences. Live = Board black (matchup as big scoreboard tile / versus screen). Standings = framed Tecmo ranking screen, viewer row wears the cursor. Quick actions = play cards with existing pictograms. Trophy case = Tecmo trophy screen. All Home named rules carry over.
4. Scope: every /league/:id/* route in five waves, one PR each:
   1 Dashboard; 2 Matchup, Game Center, Pick'em; 3 Lineup, Waivers, Trades; 4 Draft room + Draft presenter (gate: tests/e2e/draft-accessibility.spec.ts); 5 Commissioner console, Draft settings, Rules, History, Activity, Power rankings.
   Untouched: Nav, footer, DraftSim, non-league pages, /league and /league/join.
   Anti-goals: sportsbook read (odds bar keeps "win probability · Endzone Forecast"), position/grade colors as decoration, pixel type on long text, em dashes.
5. States: phases pre-draft, drafting, in season, game day live, complete; fantasy, pick'em-only, both; commissioner and member; loading, error, empty; 4-16 teams, long names, busy feed, chat unread; both themes; phone and desktop.
6. Layout: pixel h1 + status line, cursor play, the page's main board, secondary frames. Tables keep sticky columns and tabular figures; 44px phone targets. Kit adds tables, tabs, inputs, selects, toggles, steppers, dialogs, menus, framed chat drawer. Motion reuses Home's stepped set with reduced-motion paths.
7. Rulings: rename home-* once in wave 1 to a shared league-wide namespace; Game Center keeps amber LED retro-scoreboard; position and grade chips need contrast pairs on Panel and Board; new ADR retiring the dash-* island (supersedes the island parts of ADR 0020 and 0034); rewrite DESIGN.md Overview and Island Boundary Rule.
   Canvas: kit boards; Dashboard per phase and type, both themes, phone and desktop; one sample board each for Matchup, Lineup, Draft room, Commissioner console. Then one spec issue per wave.
