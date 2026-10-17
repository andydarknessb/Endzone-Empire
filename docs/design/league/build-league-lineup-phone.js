// Lineup on a phone (390), Sunday 9:10 AM, a move in progress. Puka Nacua (Out) is selected; the phone shows one section at a time (Starters here), the move strip and the three toggles are pinned.
const k = require('./league-kit-lineup');
const out = process.argv[2];
// Measured pinned footer (move strip over the toggles) at 390 wide, plus 16px: the page's scroll-padding-bottom, so a focused row is never under it (WCAG 2.4.11).
const FOOTER_PX = 126, SCROLL_PAD = FOOTER_PX + 16;
// A WR can move to WR 2 or the empty FLEX (bench Addison sits in the Bench view). Everything else in the Starters view is not eligible.
const modeFor = e => (e.name === 'Puka Nacua' ? 'moving' : e.slot === 'WR 2' || e.slot === 'FLEX' ? 'eligible' : 'dim');
const startersView = k.startersFrame({ clock: 9, phone: true, row: e => ({ mode: modeFor(e) }) });

const body = `<main style="padding: 24px 16px 24px; display: flex; flex-direction: column; gap: 20px">
${k.head({ phone: true })}
${k.summaryStrip({ clock: 9, phone: true })}
${startersView}
${k.notes([
  'A move in progress: Puka Nacua (WR, Out) is the pressed row and holds the one cursor. WR 2 and the empty FLEX are highlighted in Play-blue (the bench WR Jordan Addison is eligible too, but he lives in the Bench view, which the page does not switch to because Starters already holds legal targets). Every other row keeps full opacity: Dim name, a dashed rule and "not eligible" for screen readers. Rows carry the Edge line under the game line; Drop is a 44px icon button on every row.',
  'The product shows one section at a time below sm: Starters, Bench (IR folds into it) or Outlook (the Forecast, Bye clusters and the matchup preview). The three footer toggles are exclusive, drawn in the Play-select look with the pressed one filled Play-blue plus an arrow, named "Starters, 8 of 9 filled", "Bench, 6 players" and "Outlook"; here Starters is pressed, so the Bench and Outlook views are not on this board (LineupStates draws them). No filled action while a move is open: the strip offers Cancel (aria-keyshortcuts="Escape") and the pick is a highlighted row.',
  `The footer is one pinned container: the move strip stacked over the toggles, 44px targets, only the sentence is the polite live region. The page sets html { scroll-padding-bottom: ${SCROLL_PAD}px } (the measured ${FOOTER_PX}px footer plus 16px) so a focused row is never under it.`,
])}
</main>
${k.phoneFooter({ view: 'starters', moving: 'Puka Nacua' })}`;

k.write(out, 'LineupPhone.dc.html', k.page({ title: 'Lineup, phone', w: 390, h: 2300, body, phone: true }).replace('</style>', `html { scroll-padding-bottom: ${SCROLL_PAD}px }\n</style>`));
console.log('ok');
