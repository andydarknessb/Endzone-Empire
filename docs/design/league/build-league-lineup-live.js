// Lineup on game day, Sunday Oct 18, 2:40 PM CDT, Week 7. All eight Sunday Early games are live in Q4; FLEX is empty and no bench player can fill it.
// Cursor on the empty FLEX (Danger: the next kickoff, 3:25 PM, is 45 minutes away). No filled action: there is no move plan.
const k = require('./league-kit-lineup');
const out = process.argv[2];
const D0 = require('./lineup-data');
const note = k.lineupNote('live');
const rowOpt = e => (e.empty ? { cursor: 'urgent', note } : {});
const opts = { clock: 240, row: rowOpt };

const body = `<main style="max-width: 1280px; margin: 0 auto; padding: 40px 32px 64px; display: flex; flex-direction: column; gap: 24px">
${k.head({ live: true })}
<div style="display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: 24px; align-items: start">
<div data-testid="lineup-roster-column" style="display: flex; flex-direction: column; gap: 24px; min-width: 0">${k.summaryStrip({ clock: 240 })}${k.startersFrame(opts)}${k.irFrame(opts)}${k.benchFrame(opts)}</div>
<div data-testid="lineup-outlook-column" style="display: flex; flex-direction: column; gap: 24px; min-width: 0">${k.forecastPanel({ mode: 'live' })}${k.byeClusters()}${k.matchupPreview({ mode: 'live' })}</div>
</div>
${k.notes([
  `Cursor: the empty FLEX row, in the Danger frame because the next kickoff (Sun ${D0.NEXT_LOCK}) is ${k.MIN_TO_LOCK} minutes away (red is for under one hour). The row carries the lineup note, the one place FLEX is called empty: "FLEX is empty · no bench player can fill it · add a free agent playing at ${D0.NEXT_LOCK}", with only "next kickoff in ${k.MIN_TO_LOCK} min" in the Danger text token, and the ghost "Free agents" link. No filled action: no bench player is unlocked (Spears, Addison, Kincaid, Bigsby and Allgeier are live in Q4, Olave is on bye), so the Forecast has no move plan and Apply is not drawn. "No bench player can fill it" is the shipped copy (entities/roster/model/lineupNote.js:131-140): canFill means an eligible bench player whose game is unlocked, who is not Out and whose availability is not false, so Olave on bye and Odunze on IR do not count.`,
  'Live rows: a locked row carries the lock pictogram and keeps its Drop button; its points are live (Allen 19.8, Gibbs 16.9, Marks 9.1, Chase 15.2; bench Spears 13.4, Addison 9.2, Kincaid 6.1, Bigsby 4.4, Allgeier 7.2, the same figures as the Matchup boards) with "proj x" as line two; the game cell is the score and clock over possession and down. Edge lines: pace on live rows ("90% of projection so far (19.8 of 22.1 pts)"), the injury lines on Marks and Nacua, and "Outprojects Woody Marks at RB" on Spears. Nacua is Out: his game is live so his row is locked, but the product prints "-" and "out" for an Unavailable starter. Totals tie out: 61.0 vs 58.9, Expected final 91.7 vs 99.6, 7 players remaining, Locked 5 of 8, win probability 42%.',
  'Product change for the spec (session ruling): when an unlocked starting slot is empty or holds an Out player and the move plan is empty, the page must not say "Lineup set". The cursor row\'s lineup note says the slot is empty; the Advice tile reads "No bench move" and the Forecast panel\'s empty state reads "No move from your bench" (LineupStates draws "Lineup set" for when nothing is open). Edge and live-points colours are Ink and Dim, not the product\'s tints. The lean line is absent (gap 7.9 is under 10). The Bye clusters line reads "Waivers clear Wed 2:00 AM." (product copy change). Live is the Live chip on the h1 row and the Board-black preview, whose line "Ahead now, projected to trail by 7.9" stands in for the server narrative; no "as of" stamp, since the page updates over the scores socket.',
])}
</main>`;

k.write(out, 'LineupLive.dc.html', k.page({ title: 'Lineup, game day', w: 1440, h: 2300, body }));
console.log('ok');
