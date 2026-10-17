// Lineup before kickoff, Sunday Oct 18, 9:10 AM CDT, Week 7. Cursor on the Out starter whose game locks first; the one filled action is the Forecast's Apply.
const k = require('./league-kit-lineup');
const out = process.argv[2];
const D0 = require('./lineup-data');
const rowOpt = e => (e.cursor ? { cursor: 'cursor' } : {});
const opts = { clock: 9, row: rowOpt };

const body = `<main style="max-width: 1280px; margin: 0 auto; padding: 40px 32px 64px; display: flex; flex-direction: column; gap: 24px">
${k.head()}
<div style="display: grid; grid-template-columns: minmax(0, 1.9fr) minmax(0, 1.1fr); gap: 24px; align-items: start">
<div data-testid="lineup-roster-column" style="display: flex; flex-direction: column; gap: 24px; min-width: 0">${k.summaryStrip({ clock: 9 })}${k.startersFrame(opts)}${k.irFrame(opts)}${k.benchFrame(opts)}</div>
<div data-testid="lineup-outlook-column" style="display: flex; flex-direction: column; gap: 24px; min-width: 0">${k.forecastPanel({ mode: 'pre' })}${k.byeClusters()}${k.matchupPreview({ mode: 'pre' })}</div>
</div>
${k.notes([
  `Cursor: Puka Nacua's row (Out; his game, JAX @ LAR, locks first at Sun ${D0.FIRST_LOCK}), a 4px Cursor frame, a real button (aria-pressed) with the name and Drop as their own buttons on top. One cursor, because Out is the starter that needs the viewer. Filled action: the Forecast's Apply, the only accent-filled control. Both moves ride one Apply: the suggestion card is the swap the Forecast ranked (Addison for Nacua, +10.1), the empty FLEX fill sits in the move plan, so the plan line above Apply names both once, in the form adviceNote({ suggestions, openSlotFills }) builds (entities/roster/model/adviceNote.js); the strip's Advice tile keeps the product string, "+23.0 pts · 2 swaps".`,
  'Drawn to the product: Starters, IR, then Bench in that order. Rows carry the Edge line from the server (computeEdgeLine, first match wins): "questionable" on Woody Marks, "out" on Puka Nacua, "injured reserve" on Rome Odunze, and "Outprojects Woody Marks at RB" on Tyjae Spears, the one bench player above a starter he can replace. Game detail lines come from week7-games.js in the product format ("BUF -6.5 · O/U 48.5 · 44° · wind 16", "Dome"); slot labels are RB 1, RB 2, WR 1, WR 2; injury tags print the product codes (Q, O, IR) with the status for screen readers; row names end "projected x". The strip is the card "This week"; Bye clusters are the 7-week tile grid (Wk 8 has four byes: the warning tile and the Needs attention chip, drawn inverted Ink, not red). The lean line is absent (Expected-final gap 4.8, under 10) and the Forecast card shows no fact chips (no game reaches total 48 or favored by 7).',
  'Product changes for the spec: PickWeek on Lineup passes allWeeks={false} (the button is inert today); the Edge line and live points colours move off the product tints (dash-faint, dash-danger) to Ink and Dim with the kind pictogram, never green or red; the Bench card\'s "Bench points this season" line is removed because it is the same quantity as the Forecast\'s "Left on the bench this season" (hindsight totalPointsLeftOnBench), which says it once; a plan line above Apply names both moves; the Bye clusters line reads "Waivers clear Wed 2:00 AM." in this blanket-weekly-clear league, not "in 48 hours". Locked rows keep their Drop button (the product shows Drop on any current-week, unspent row), a 44px track. Every occupied row draws the PlayerAvatar (36px, 28px on a phone) as a neutral initials square: the product tints it with the NFL team&#39;s jersey colour and the board drops that colour (no brand hex), a colour change for the spec. The week picker is one tab stop and its strip scrolls inside its own box.',
])}
</main>`;

k.write(out, 'Lineup.dc.html', k.page({ title: 'Lineup, before kickoff', w: 1440, h: 2300, body }));
console.log('ok');
