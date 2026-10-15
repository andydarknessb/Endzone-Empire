# League Play-select canvas: rulings (binding for every builder)

Read BRIEF.md first. This file settles what the brief left open. The world is the shipped Home Play-select system: DESIGN.md section "Home surface: Play-select" at E:/ee-league-canvas/DESIGN.md (read it) and `src/kit.js` (the Home canvas kit, reuse it, never copy-paste its pieces into board files by hand).

## Mechanics
- Work folder: `C:/Users/Cory/AppData/Local/Temp/claude/E--endzone-empire/515e97fc-1160-436b-83f9-0e884d344d65/scratchpad/league-canvas` (call it W).
- `W/src/kit.js` is the Home kit (do not edit it). `W/src/league-kit.js` extends it (`const k = require('./kit')`, re-export everything plus the new league pieces). Only the kit builder edits league-kit.js; other builders may ADD pieces only by appending a clearly named function at the end and re-exporting it, never by changing an existing one.
- One build script per board: `W/src/build-<board>.js`, run as `node build-<board>.js ../project` from W/src. It writes `W/project/<Board>.dc.html`. Model them on `W/src/build-main.js` and `W/src/build-gameday.js`.
- Boards use `k.page({ title, w, h, body, phone })`: tokens are `{{t.name}}` holes, both themes via the `light` prop. Never hard-code a hex in a board; every color is a `{{t.x}}` token in league-kit's TOKENS (extend TOKENS there, both themes).
- Check your boards render: `node render-boards.js ../project ../renders <BoardPrefix>` from W/src (Playwright, writes PNGs to W/renders, both themes). Fix H-OVERFLOW. Look at your PNGs once, fix, re-render once, stop. Report the final content heights (dark) so the index heights can be set.
- Do NOT publish to the Artifact, do NOT edit `W/project/canvas.json`, do NOT touch any git repo. E:/ee-league-canvas is read-only reference code.

## Copy and data
- Real copy from the research inventories in `W/research/*.md`; keep the product's own labels unless a ruling below renames them. CONTEXT.md glossary terms exactly ("Pick", never "bet"; "Slate"; "Endzone Forecast", never "the model"; "Kickoff"; "Locked").
- No em dashes anywhere (use middot ·, hyphen scores, en-dash ranges). No emoji. No invented product stats (user counts, testimonials). Mock league data is fine: League "Thursday Night Regulars", 12 teams, viewer team "Darkness Falls" (manager andy1234), Week 7, times in CDT. Real NFL player names are fine for mock rosters.
- Pixel type (Press Start 2P) only at 16/24/32 via `k.px()` / `k.h1` / `k.h2`: h1, h2, scores, team names in heads, lock times, chip text. Everything read as a sentence, every table row, feed, form and chat stays Archivo.

## Page skeleton (every league page)
1. Head: pixel h1 = league name (or page name + league name as a dim line above it on subpages), then a status line in Archivo 17px dim: "Week 7 · In season · 12 teams · times in CDT". Live chip (`k.liveChip`) on game day. Commissioner sees "Invite code" control (ghost button, code in Archivo mono-ish 600) on the dashboard head right.
2. No new navigation: keep the navigation each page has today (the research inventories say what it is, e.g. a back link to the dashboard). Restyle it, never add a tab strip or menu that does not exist.
3. "Your move": the cursor play. Exactly ONE cursor per page (One Cursor Rule), sitting on the viewer's next move in THIS league. On the dashboard it is a `k.playCard` (lead, filled foot) in a "Your move" frame with up to two more non-lead play cards (outlined feet) beside it. On subpages the cursor may sit on a row (Lineup: the slot that needs action; Draft room: your pick action; Commissioner: the pending join request) instead of a card.
4. The page's main board, then secondary frames.

## Dashboard pieces
- Matchup: before kickoff, a framed versus panel: both team names Pixel 16, projected figures Pixel 32, `k.oddsBar` in Frame color, "Matchup" link. Game day: the Board-black scoreboard tile scaled up as a versus screen (Pixel 32 scores, leader white, trailer Board dim, margin Pixel 16, live odds bar), with the score block as one link; score flash class `.scored` on one board to show it.
- My team: a framed panel: record Pixel 24, rank, points for, the next lock; links Lineup, Waivers, Trades.
- Standings: a framed Tecmo ranking screen "Standings". Columns: rank, team (avatar square 28px + team name Archivo 15 600), W-L-T, PF, PA, streak. Rank and figures tabular. Rows 44px with 2px Rule dividers, no zebra. The viewer's row is NOT a cursor (the cursor belongs to Your move): it gets the Play-blue fill (`{{t.play}}` bg, `{{t.playInk}}` text) and a pixel arrow before the team name. Playoff cutline: a 2px dashed Frame rule with a small "Playoff line" label. Header labels Archivo 13 600 uppercase Dim.
- Around the League: the other matchups as small tiles in a grid: framed before kickoff, Board black while live (reuse `k.scoreTile` shapes at small size), final shows the winner white.
- Recap: framed panel "Week 6 recap", pixel headline line, Archivo body, "Read the recap" link. Labeled as a recap, never a Projection.
- Recent activity: framed feed, Archivo rows: kind tag (Archivo 12 700 uppercase in a 2px Rule-bordered square box: ADD, DROP, TRADE, CLAIM, LINEUP), sentence, time in Dim 13px. Max rows per research cap.
- Quick actions: a "Playbook" frame: grid of small play tiles (Play-blue fill, 96x48 pictogram from k.picto, label Archivo 15 600 playInk, 2px playInk border, whole tile a link, min 44px). No filled foot on these (One Filled Action Rule).
- Trophy case: a "Trophy room" frame: pixel trophy pictogram per award, award name Pixel 16, season + team Archivo.
- Commissioner strip: a "Commissioner" frame for commissioners only: rows with an item and a ghost button; never filled; red only if something is under one hour.
- Chat: a square 56px button bottom-right (2px Ink border, Panel fill, pixel speech icon, unread count badge 28px square), opening a framed drawer (6px double Frame) with Archivo messages. Show the drawer open on one phone board.
- Pre-draft countdown: "Draft starts in" frame with the countdown in Pixel 32 (days, hours, minutes blocks) and the draft date.

## Kit additions (league-kit.js), all on 8px grid, square corners, no shadows
`tabs` (only where a page already has tabs, e.g. Draft room panels), `table({ cols, rows, viewerRow })` with sticky first column and overflow-x box at phone width, `posTag(pos)` (2px border + text in the position color, Archivo 13 700, square; tokens posQb..posIdp from src/theme/tokens.js pos-* values: dark theme uses the dark values, light uses the light values), `gradeChip(grade)` (fill = dash-grade-* fill values, ink #07080f via a token), form controls: `field({label, value, hint})` text input, `select`, `toggle` (square 44x24 track, pixel knob), `stepper` (- value +, 44px buttons), `radioCards`, `dialog({title, body, actions})` framed 6px double Frame on a Field scrim, `menu` (framed list), `chatDrawer`, `activityRow`, `trophy`, `countdown`. Focus ring and motion exactly as Home (HELMET in kit.js).

## Rulings on states
- Red only for <1 hour locks, the draft clock under 30 seconds, and errors.
- Green only on the one filled action and live state.
- Phone (390 wide): no page side-scroll, Your move stacks, standings keep rank/team/W-L-T and move PF/PA/streak behind horizontal scroll in the table box.
- Light theme: same pieces, light token values; Board stays black.

## Rulings after the kit pass (2026-10-15)
- Main.dc.html (W/project) is the reference board: match its frames, spacing, head and panel patterns. W/renders/Main-dark.png shows it.
- Never invent data the product does not have. The "Projected by position" table on the versus panel is removed, and the recap has no invented pixel headline (the recap is fact rows + narrative only). Every figure must map to a field in the research inventories.
- A confirm dialog may carry its own filled button: the modal blocks the page, so it does not break One Filled Action.
- render-boards.js now takes exact board names, comma-separated: `node render-boards.js ../project ../renders GameDay,MainPhone`. It skips boards whose file does not exist yet.
- Kit edits: append-only (new functions at the end of league-kit.js, re-exported). Only the dashboard-variants builder may change versusPanel and recapPanel (to apply the removal above).

## QA round 1 rulings (dashboard), binding
Accepted fixes (QA numbering): 1, 2, 3, 4, 5, 7, 10, 12, 13, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24.
- Page order is the product's, every phase: head; commissioner strip (own row, commissioner only, facts desktop only); countdown (pre-draft with a date); hero = Matchup preview + My team (My team whenever the viewer has a team, in EVERY fantasy phase, including pre-draft; Matchup preview shows "No matchup this week" when there is none); recap (when one exists); around the league; standings + recent activity; playbook; trophy room; chat. "Your move" sits between the head and the commissioner strip. Never drop a widget the product mounts.
- Head pattern everywhere (the PickemOnly head is the model): pixel h1; chip row = phase chip ("WEEK 7 · IN SEASON" while the season is live, else the bare phase label), "{n} TEAMS" chip only when the season is NOT live and not pick'em-only, "DRAFT COMPLETE" only on complete fantasy leagues, plus `k.liveChip` on game day; then an Archivo dim line "Times in CDT" (and nothing else). The phase chip is neutral (Green Means Go: live games only). One chip border token for all head chips.
- Chip type: chips that carry a status word (phase, LIVE, Scheduled, Final, Recap) are Pixel 16. Small in-row badges ("You", avatar initials, activity kind tags, position tags, injury tags) are Archivo 13 700 uppercase. No 12px text anywhere.
- Activity kind tags are the product's: ADD, DROP, TRADE, WAIVER, SETTINGS, STAT CORRECTION, RECAP. There is no lineup event and no CLAIM tag (it is WAIVER).
- Trophy room on in-season boards: season 2026, weekly awards only (Weekly High, Closest Game, Biggest Blowout, Perfect Lineup, Called Shot), weeks 1-6, every value consistent with that board's standings and recap. Complete shows the 2026 season awards.
- At most one cursor per page. A page where nothing needs the viewer (Complete, Matchup) has none and no filled action; that is correct, not a defect.
- Quick action and Playbook statuses: draw the product's real strings, including its fallbacks ("Live scores and matchups", "Make your weekly picks" when the week is null, as in pre-draft) and "Set your Week 17 lineup" on a complete league (that is what the product shows). QA items 8 and 9 are rejected.
- Position tags are data encodings, exempt from Red Is Rare (posQb light = #c62828 stays). QA 14 rejected.
- Live versus screen: per side the live score, the "Expected final" figure and "PMR"; no "updated N min ago" (the dashboard does not poll).
- Rows of frames stretch to equal height (align-items: stretch; frame height 100%); an empty Recent activity stacks under standings instead of beside it.
- One invite code everywhere: TNR-7K4Q.

## QA round 1 rulings (kit, states, samples), binding
Accepted (QA2 numbering): 1, 2, 3, 4, 5, 8, 9, 10, 11, 13, 14, 15, 16, 17, 18, 19, 20. Rejected: 6 (position tags are data encodings, exempt; see above), 7 (the product's button is "Advance to Week {next}", dashboard research). 12 ruled: buttons inside dense desktop tables may be 36px; every other control, including rail buttons, is 44px.
- Lineup: no "Swap player" button (not a product control). The cursor sits on Puka Nacua's row (Out), and the row is a real `<button aria-pressed>`; player names are buttons that open the player card; each row has a quiet icon "Drop player". The one filled action is the Endzone Forecast suggestion's "Apply", and that suggestion is "Start Jordan Addison over Puka Nacua". Kit uses the same pattern.
- Ineligible rows during a move: no opacity. Dim name, dashed row rule, sr text "not eligible"; all text stays at AA.
- Draft room gets a second board, DraftRoomNarrow.dc.html (1024 wide, fluid): commissioner, container under 1200px, so the tablist "Draft view" with tabs Chat / Players / Board / Draft (Board selected, aria-selected), the section "Commissioner draft controls" (Pause Draft, Correct latest Pick, Reset draft, Presenter link, "Keeper picks cannot be corrected."), and the "Draft Board" region (Rd + team columns, picks with position tags, the on-clock cell "Round 4, Darkness Falls: on the clock"). Not your pick on this board: "{Team} is on the clock" in the banner.
- Draft room banner: no "picks made in this round" meter. Rail adds the framed "Draft assistant" section ("Misery Meter", "Quiet so far. Make a pick.").
- Commissioner: with Waivers & Trades selected there is no Destructive actions frame (it lives in General Settings). Join requests carry no request time. No "Visible to commissioners only" on the console.
- Copy the research does not support is removed (Matchup "Scores updated", "10 games this week", "4 most recent").

## Confirmation-pass rulings (final batch), binding
All 10 findings accepted.
- GameDay: live versus screen on its own full-width row; My team below it, full width (myTeamWide: record/PF/PA/next lock left, 5 starters right); drop `flex: 1; justify-content: space-between` from the versus score link. Main keeps the product's 2-up hero; pack Main's versus content so no band over 40px is empty.
- One Darkness Falls Week 7 fixture (starters, slots, injuries, kickoffs, projections, bye) shared by Main, MainPhone, GameDay, GameDayPhone, Lineup, LineupPhone, Matchup; Main's lineup status line and next lock derive from it. McBride plays Sun 3:25 PM (no Thursday final on the pre-kickoff boards). Matchup and Lineup agree on FLEX. DraftRoom chat never drafts a player who is on Darkness Falls' current roster to another team.
- Commissioner facts identical on console and dashboard: "Teams locked 9 of 12", "Trade review 24h".

## Critique rulings (owner answers, 2026-10-15), binding, supersede earlier page-order text for game day
- Game day order: head; Your move; live versus screen; My team; Commissioner strip; then recap, around the league, standings + activity, playbook, trophy link. Other phases keep the product order. "Advance to Week {n}" is disabled with its reason as text ("Opens when every Week 7 game is final") while any game of the week is unfinished.
- Set lineup stays a play while any unlocked starting slot is empty or Out; its lock is the next eligible kickoff. On GameDay it shares the 3:25 PM lock with Week 7 picks, so both are ONE card under the one urgent cursor (Shared Lock Rule: one card, one foot per action), or two feet on one card.
- The "Your move" badge equals the number of cards in it. A pick'em card's lock is the earliest unpicked game's kickoff.
- Say it once: "+23.0 pts available" lives in the lead card's lock note; delete the separate Forecast box and the matchup sentence that repeats it; "Lineup incomplete" stays only in My team if not duplicated by the card. Starter figures get a column label ("Proj" before kickoff; live "Pts" plus "Proj" on game day).
- Container tiers: Board black for live; 6px double rule for primary frames (Your move, Matchup, My team, Standings); a 2px single Rule border for tertiary frames (Recap, Around the league, Recent activity, Playbook) with h2 at Pixel 16; trophy room mid-season becomes one link row ("Trophy case · 6 awards this season") instead of a frame (Complete keeps its full trophy frame). Playbook drops tiles whose link already appears elsewhere on the page (e.g. Set Lineup when it is a play, Waivers/Trades when My team links them).
- No floating "vs" band on the full-width live screen: the two sides sit close with the margin between them.
- Drop "Visible to commissioners only" and the repeated "times in CDT" in frame heads (the head line carries it).
- Live screens show "As of 2:40 PM" in Board dim under the LIVE chip (the dashboard does not poll; the stamp is honest).

## Critique 2 rulings (owner answers, 2026-10-15), binding
- Phone folds (MainPhone, GameDayPhone only; desktop unchanged): standings show the viewer row with two teams above and below plus the playoff line, then a "Full standings" link (a real `<a>`); Recent activity capped at 3 rows with "All activity"; the in-season Playbook becomes one link row like the trophy case ("Playbook · Draft Room, Power Rankings, History, League Rules").
- Space: Your move cards align to the top (no stretched blue), non-lead cards keep their own height; Main's versus panel has no band over 40px.
- One fixture clock: Main is Sunday Oct 18, 9:10 AM CDT; GameDay is Sunday Oct 18, 2:40 PM CDT. Every relative time ("1d ago", "Generated ...") derives from those. Week 6 recap generated Tue Oct 13, 9:00 AM, so "5d ago" on both.
- Wording: projected figures are "Proj" everywhere (keep "Expected final" only where the live screen shows the product's live expected final); PMR is shown as "7 players remaining" (abbr "PMR" with its expansion for screen readers once); one "win probability · Endzone Forecast" credit per frame, and each odds bar's accessible label names the team ("Blitz Brigade win probability 82%"). STAT CORRECTION tag must not wrap (widen the tag column or use "STAT FIX"? no: keep the product label "Stat correction" and let the kind column fit it).
- Card detail lines drop the league name (the h1 says it): e.g. "Darkness Falls · 9 of 14 picks made".
- New: Pick'em panel on fantasy+pick'em dashboards (Main, GameDay, MainPhone, GameDayPhone): a 2px-tier frame "Pick'em" directly after My team: "Your rank" (T-3), "Points" (season), "Wk 7" (points so far or "9 of 14 made"), "Behind leader", and a "Picks" link. Data is the product's pick'em standings row (research dashboard.md, Pick'em standings viewer strip). Desktop: sits in the hero area beside or under My team without breaking the hero; phone: after My team.
- On phone game day, the Invite control moves out of the head into the Commissioner strip.

## Critique 3 rulings (owner: keep iterating; 2026-10-15), binding
1. Live scoreboard: true Board black edge to edge inside its frame; no `.scored` wash at rest on any board (the flash is described in the design notes and shown only on the Kit as a labeled specimen); content not inset more than 24px; both team names on one baseline; the margin ("UP 2.1") sits directly under the viewer's score.
2. Name the swap: the lead card's note reads "Start Jordan Addison for Puka Nacua · +23.0 pts" (from the fixture: Addison on the bench, FLEX-eligible). My team's "Lineup incomplete" row carries a "Fix lineup" link. Injury chips: Out is a filled Ink chip with Panel text ("OUT"), Questionable/Doubtful stay outlined ("Q", "D"); never red.
3. Say it once: My team drops "Next lock"; the matchup head drops its kickoff line; in season the Playbook and the trophy case merge into one link row ("Playbook · Power Rankings · History · League Rules · Trophy case (6)"); the "Draft Room · Draft complete" tile is gone in season; the recap frame drops its redundant [RECAP] chip; the activity count is plain meta text ("8 moves"), boxed badges are only for "things need you" and chat unread.
4. Your move on desktop: the lead card on the left, non-lead cards as compact cards (name, lock, foot; no field band) stacked on the right; no empty frame area over 40px. Phone: lead full card, non-lead compact.
5. Screen readers: live screens carry a visually hidden `aria-live="polite"` region with the score sentence ("Darkness Falls 61.0, Sunday Scaries 58.9, as of 2:40 PM"); the lead card's group is named by its heading (aria-labelledby), not a label repeating its visible text.
6. Pick'em panel figures (rank, points) in Pixel like My team's record.
7. Game-day top rule (owner): when no lock is under one hour, the live scoreboard leads the page and Your move follows it, showing "You're set" (a calm card: "Lineup set · picks in · next lock Mon 7:15 PM", no cursor, no filled action) when nothing is due. New board GameDaySet.dc.html (desktop 1440 fluid, Sunday 4:10 PM, same league, commissioner, lineup set and picks in, late games live): scoreboard first, then You're set, My team, Pick'em, Commissioner, rest. GameDay (45 min lock) keeps Your move first.

## Critique 4 rulings (owner: fix all 5, then approve; 2026-10-15), binding
1. Live scoreboard: league-kit.js versusLive uses `grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)` with sides at the frame's inner edges (24px padding), the opponent side right-aligned; the odds row is full width (no max-width 856px, no margin auto). Applies to GameDay, GameDaySet, GameDayPhone, Matchup-style uses.
2. One label per destination: the Lineup page is "Set lineup" everywhere it is an action and "Lineup" in link rows; drop "Fix lineup" when Your move carries Set lineup (keep it only when no card does). The matchup page is "Matchup" in both phases (no "Compare rosters").
3. Around the league tiles before kickoff label figures "Proj".
4. One h2 size for primary frames: Pixel 24 desktop (Your move, Matchup, My team, Standings), Pixel 16 phone; tertiary frames Pixel 16.
5. Game day (GameDay, GameDaySet and the phone): Around the league shows the viewer's league rival games as 3 tiles max plus "All matchups in Game Center"; Recent activity shows 3 rows plus "All activity".
6. Fixture: the Woody Marks claim is last week's (Wed Oct 14, 2:00 AM, "4d ago"); the 38m-ago feed row becomes a different, plausible Sunday move (e.g. a free-agent add after a Sunday inactive).
7. The lead card keeps "Set lineup" as a link to the Lineup page (owner ruling: no one-press swap).
8. Minor: no orphan "Forecast" on phone (nowrap "Endzone Forecast"); light-theme tertiary frames use the Frame color at 2px so they read on the lavender Field.
