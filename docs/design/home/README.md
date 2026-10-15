# Home: Play-select canvas

Published canvas: https://claude.ai/artifact/MU9fvovmpKB5cSD5eExJWe (version 27). DESIGN.md "Play-select: Home and league pages" is the written system; these boards are the spec it describes.

- `kit.js` holds every shared piece (tokens per theme, frame, play card, pictograms, odds bar, scoreboard and pick'em tiles, motion CSS). The `build-*.js` scripts each write one board from it: `node build-main.js .` rewrites `Main.dc.html` here.
- `render-boards.js <dir> <outDir>` resolves the tokens and screenshots every board in both themes (Playwright). `check-motion.js` asserts the cursor, press and score-flash rules on the rendered HTML.
- Facts on the boards are mock data (Puka Nacua Out, "You pick 7th", Confidence points 412/447/71/23, "Picks this week 9-5"). Production shows them only when the API carries them.
