// Pick'em on a phone, same moment, a pick just saved: SF on ARI at SF shows 'Pick saved · Undo', 10 of 14 picked, cursor on DAL at DEN. Save on tap (Critique 10): no SaveBar.
const k = require('./league-kit-pickem');
const out = process.argv[2];
const LG = 'Thursday Night Regulars';
const extra = { 'ARI|SF': { my: 'SF', save: 'saved' } };
const st = { ...k.pickStatus({ ...k.MY_PICKS, 'ARI|SF': 'SF' }), phone: true, cursorId: 'pk-cursor' };
const board = `<section aria-labelledby="pk-h" style="display: flex; flex-direction: column; gap: 14px; min-width: 0">
${k.picksHead(st)}
${k.weekStrip({ week: 7, phone: true })}
<div style="display: flex; flex-direction: column; gap: 16px">
${k.windows(k.GAMES, { total: 12, phone: true, cursorId: 'pk-cursor' }, 'DAL|DEN', extra)}
</div>
${k.pkHelp({ phone: true })}
</section>`;

const notes = k.notes([
  "A pick just saved (Critique 10): the viewer tapped SF in ARI at SF and the pick saved at once. The card's status line (44px, under the teams) reads 'Pick saved' with a pixel check, then 'Undo' as a ghost button for the change just made (Undo restores the previous pick, or no pick). Only the words 'Pick saved' are the polite live region (role=status); Undo sits beside it, outside the region. SF is Play-blue with the check and the word Pick like every saved pick; the team button's accessible name starts with the visible abbreviation and adds 'saved' ('SF, San Francisco 49ers over Arizona Cardinals, Sun 3:25 PM, locks in 45 min, saved'). There is no bottom bar, no batch-save button, no sticky bar and no filled action on this page.",
  "The Picks h2 row is the one status place: 'Picks' then '10 of 14 picked · 1 open · next lock Sun 3:25 PM' (plain text, not a live region; 'next lock' is an in-page link to the cursor card with a 44px hit area). The cursor moved to the next unpicked unlocked game, DAL at DEN (also 3:25 PM, so still Danger). All three open Sunday Late cards say 'Locks in 45 min' on the kickoff line and in the team buttons' accessible names, DAL at DEN with the frame and ARI at SF (saved) and KC at LV without it. The cursor card has scroll-margin-top (432px here: the ARI at SF card, now carrying its status line, sits between the Sunday Late heading and the DAL at DEN card, so the margin is that distance plus 16px).",
  "Commissioner settings is one collapsed row above the sections control (the title and 'Pick'em on · Straight up · locked for the season' wrap, ghost 'Edit' 44px, aria-expanded false). Settled windows collapse to one row with a ghost 'Show games' control (44px, aria-expanded false): Thursday Night 'Final · 1 of 1 correct' (a one-game window never earns Perfect), Sunday Early '8 live · 5 picked · 3 no pick'. Windows with open games stay expanded and each head says 'League picks reveal at kickoff' once.",
  "The breadcrumb drops the current page (the h1 says it): 'Leagues / Thursday Night Regulars', no trailing separator. Team buttons are named '{ABBR}, {Team} over {Opponent}, {day time}{, locks in n min}' with aria-pressed. The week picker is one tab stop (selected week tabindex 0, the others -1, Left and Right arrow keys move the week); 'What the numbers mean' closes the Picks section, closed. Team buttons stack their content (abbreviation, FAV, full name, record, pick mark) and stay 2-up; the week buttons scroll sideways inside their own box between the 44px Previous and Next arrows, which stay visible, so the page never scrolls sideways.",
]);

const body = `<main style="max-width: 390px; margin: 0 auto; padding: 14px 16px 0; display: flex; flex-direction: column; gap: 16px; min-height: 100vh; box-sizing: border-box">
${k.pkHead(LG, { phone: true })}
${k.commissionerPanel({ mode: 'straight', phone: true })}
${k.sectionsControl({ selected: 'picks', phone: true })}
${board}
${notes}
</main>`;
k.write(out, 'PickemPhone.dc.html', k.page({ title: "Pick'em, picks, phone", w: 390, h: 3405, body, phone: true, cm: 432 }));
console.log('ok');
