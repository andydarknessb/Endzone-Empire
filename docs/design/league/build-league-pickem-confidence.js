// Pick'em, Sunday Pick'em (pick'em-only, confidence mode), viewer is commissioner, 0 of 14 made, first lock Thu 7:15 PM (more than an hour away).
const k = require('./league-kit-pickem');
const out = process.argv[2];
const LG = "Sunday Pick'em";
const open = () => 'open';
// Managers who have picked each game, 5 to 8 of 10, summing to 95 (the PickemOnly board's Pending total).
const PICKED = k.SUNDAY_PICKED;

const st = k.pickStatus({}, open);
const sb = { picked: st.picked, open: st.open, next: st.next, cursorId: 'pk-cursor' };
const board = `<section aria-labelledby="pk-h" style="display: flex; flex-direction: column; gap: 16px; min-width: 0">
${k.picksHead(sb)}
${k.rankStrip({ used: [], total: 14 })}
${k.weekStrip({ week: 7 })}
<div style="display: flex; flex-direction: column; gap: 24px">
${k.windows(k.GAMES.map((g, i) => ({ ...g, n: PICKED[i] })), { total: 10, mode: 'confidence', my: null, phase: open, urgent: false, cursorId: 'pk-cursor' }, 'PIT|CLE')}
</div>
${k.pkHelp({ confidence: true })}
</section>`;

const notes = k.notes([
  "Commissioner settings comes first, exactly where the product mounts it, as one collapsed row: 'Commissioner settings · Confidence · locked for the season' with a ghost 'Edit' (aria-expanded false; 'Hide' when expanded). A pick'em-only league cannot turn Pick'em off, so the row drops 'Pick'em on' (Critique 10 item 7). The expanded panel (lockedOn copy, disabled scoring cards with a round indicator, and the reason line) is drawn on the States sheet.",
  "Confidence mode saves on tap (Critique 10): choosing a rank saves it, with no batch-save button, no bottom bar and no unsaved state. A rank held by another game stays in the select's menu, marked 'Confidence 14 · used by DAL @ DEN'; choosing it swaps the two games' ranks (both saved) and the card says 'Swapped with DAL @ DEN' (the specimen and the open menu are on the States sheet). A rank held by a game that has kicked off cannot be swapped: its menu row reads 'Confidence 9 \u00b7 locked, PHI @ MIN', is aria-disabled and cannot be chosen, and its rank-pool cell carries a small lock (drawn on the States sheet; nothing has kicked off on this board). Nothing has a rank yet, so no card shows a save line and every select reads 'Confidence: none'.",
  "The rank pool sits in a sticky strip at the top of the Picks section (position: sticky; top: 0, solid Page background, 2px Rule under it): '14 ranks left' and the 14 cells (used ranks filled and numbered, free ranks outlined; one image named 'Ranks used: none', cells hidden from the tree; the words are plain text, since the card's save line is the one announcement per tap). The page reserves its height with scroll-padding-top (58px: the 42px strip plus 16px) and the cursor card has scroll-margin-top (120px: strip, heading, 16px), so neither a focused card nor the jump from 'next lock' lands under it.",
  "Confidence league: a rule line every member sees sits under the blurb, 'Confidence league: give each game a rank from 1 to 14, each used once. A correct pick earns its rank.' Each open card gets a 'Confidence: none' select beside the odds badge, disabled (solid Rule border, Dim text, no opacity) until a team is picked; one hint per window head says why, 'Pick a team to set its confidence', and every disabled select points at it with aria-describedby. 'League picks reveal at kickoff' sits once at the right end of each window head.",
  "One cursor on the Thursday card (earliest kickoff, unpicked). Thu 7:15 PM is more than an hour away, so the frame is yellow and no card says 'Locks in'. The one status is the Picks h2 row, '0 of 14 picked · 14 open · next lock Thu 7:15 PM' (the ranks left live in the strip, so they are not said twice; 'next lock' is an in-page link to the cursor card, a 24px-tall target, which keeps the Thursday Night heading in view). Team buttons are named '{ABBR}, {Team} over {Opponent}, {day time}' (for example 'PIT, Pittsburgh Steelers over Cleveland Browns, Thu 7:15 PM') with aria-pressed. The week picker is one tab stop (selected week tabindex 0, the others -1, arrow keys move the week). 'What the numbers mean' closes the Picks section, closed, and carries the Confidence entry (this board only). Every game is still open, so no window is collapsed.",
]);

const body = `<main style="max-width: 1280px; margin: 0 auto; padding: 24px 32px 64px; display: flex; flex-direction: column; gap: 24px">
${k.pkHead(LG, { confidence: true })}
${k.commissionerPanel({ mode: 'confidence', lockedOn: true })}
${k.sectionsControl({ selected: 'picks' })}
${board}
${notes}
</main>`;
k.write(out, 'PickemConfidence.dc.html', k.page({ title: "Pick'em, confidence, commissioner", w: 1440, h: 4367, body, cm: 120, padTop: 58 }));
console.log('ok');
