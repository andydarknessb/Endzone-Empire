# League pages: Play-select canvas

Published canvas: https://claude.ai/artifact/PrJq3Dhr94dkYbkG4hw2Vj (version 12, approved 2026-10-15). DESIGN.md "Play-select: Home and league pages" is the written system; ADR 0067 records the decision. These boards are the spec it describes.

- `BRIEF.md` is the confirmed shape brief; `RULINGS.md` is every decision made while drawing and reviewing the boards, in order (later sections win).
- `kit.js` is the Home kit (from `docs/design/home`) with two small additions; `league-kit.js` extends it with the league pieces (tables, standings screen, versus panel and live scoreboard, My team, Pick'em panel, tiers, forms, dialog, menu, chat). `league-kit-draft.js`, `league-kit-samples.js` and `kit-sections.js` add the Draft room, Lineup and Kit-sheet pieces; `lineup-data.js` is the one Darkness Falls Week 7 fixture every board reads.
- Each `build-*.js` writes one board: `node build-league-main.js .` rewrites `Main.dc.html` here.
- `render-boards.js <dir> <outDir> [Board,Board]` resolves the tokens and screenshots boards in both themes (Playwright).
- Facts on the boards are mock data (Puka Nacua Out, "+23.0 pts", invite TNR-7K4Q, the 12-team standings). Production shows them only when the API carries them.
