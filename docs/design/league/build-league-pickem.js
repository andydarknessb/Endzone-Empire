// Pick'em, Picks tab, Thursday Night Regulars (fantasy + pick'em, straight mode), Sunday Oct 18 2:40 PM CDT. Viewer: Darkness Falls, member. Save on tap (Critique 10): nothing in flight, 9 of 14 picked.
const k = require('./league-kit-pickem');
const out = process.argv[2];
const LG = 'Thursday Night Regulars';

const sb = { ...k.pickStatus(k.MY_PICKS), cursorId: 'pk-cursor' };
const board = `<section aria-labelledby="pk-h" style="display: flex; flex-direction: column; gap: 16px; min-width: 0">
${k.picksHead(sb)}
${k.weekStrip({ week: 7 })}
<div style="display: flex; flex-direction: column; gap: 24px">
${k.windows(k.GAMES, { total: 12, cursorId: 'pk-cursor' }, 'ARI|SF')}
</div>
${k.pkHelp()}
</section>`;

const notes = k.notes([
  "One cursor: the Sunday Late ARI at SF card (3:25 PM) is the earliest-kickoff unlocked game the viewer has not picked. It locks in 45 minutes, so the frame is Danger, not yellow. Every unlocked card under an hour says it in words, picked or not: ARI at SF, DAL at DEN and KC at LV all read 'Locks in 45 min' (Danger text on the kickoff line, also in the team buttons' accessible names), but only ARI at SF wears the frame. The cursor is a frame on a card, never a button.",
  "Picks save on tap (Critique 10, a product change for spec #2334): there is no bottom bar, no batch-save button, no unsaved state and no leave-confirmation dialog. Tapping a team saves that pick at once; nothing is in flight at 2:40 PM, so every card rests. Each open card carries an empty status line under its teams where the save shows in words, and that line alone is a polite live region (role=status): it holds the words only, the ghost Undo and Retry buttons sit beside it outside the region, and the Picks h2 status is plain text, so a tap makes one announcement: 'Saving…', then 'Pick saved' with a ghost 'Undo' (drawn on PickemPhone), or the Danger 'Couldn't save this pick. Retry' (drawn on the States sheet). Tapping the other team changes the pick and saves again; locked games cannot change.",
  "No filled action on this page: the cursor carries the urgency, and picked team buttons keep their Play-blue fill, pixel check and the word Pick as state only. The status lives in one place, the Picks h2 row: 'Picks' then '9 of 14 picked · 2 open · next lock Sun 3:25 PM' (open = unlocked games with no pick). 'next lock Sun 3:25 PM' is an in-page link, underlined in Ink, with a 24px-tall target (44px on phone), that moves focus to the cursor card, which has scroll-margin-top so the Sunday Late heading stays in view. The words are plain text, not a live region. When every game is picked it reads '14 of 14 picked · all saved' with a pixel check (States sheet).",
  "Settled windows collapse to one line, the window name, its summary and a ghost 'Show games' control side by side (about 64px, so the first team button sits inside the 900px first screen): Thursday Night (all final) reads 'Final · 1 of 1 correct', and Sunday Early (all 8 live) '8 live · 5 picked · 3 no pick', each with the control (aria-expanded false). A one-game window does not earn 'Perfect' (Critique 10 item 6): 1 of 1 is not an ending worth a star, so Perfect needs two or more games, every one picked and right; the 8 of 8 specimen is on the States sheet. Sunday Late, Sunday Night and Monday Night still have open games, so they stay expanded in kickoff order, and each head says 'League picks reveal at kickoff' once at its right end (the cards keep only 'n of 12 managers have picked').",
  "Picked = Play-blue fill, pixel check and the word Pick, and it stays on a locked game. Locked games say Locked with the lock icon and keep full contrast, no opacity. Final: the winner's team button takes an Ink border, the loser's score goes Dim; outcome chips (Correct, No pick) are outlined Ink. Missed reads 'Missed · picked {team}', a result word, outlined Ink, never red (States sheet). Team buttons are named '{ABBR}, {Team} over {Opponent}, {day time}{, locks in n min}' (for example 'KC, Kansas City Chiefs over Las Vegas Raiders, Sun 3:25 PM, locks in 45 min'), so the name starts with the visible abbreviation (label in name), with aria-pressed for the picked state; a card mid-save adds 'saving', 'saved' or a failed-save word to the name. Live and final cards add the score, 'has the ball' and 'winner' after the time.",
  "Andy1234 is commissioner here, so Commissioner settings sits above the sections control as one collapsed row: 'Commissioner settings · Pick'em on · Straight up · locked for the season' with a ghost 'Edit' (aria-expanded false; 'Hide' when expanded; the expanded panel is on the States sheet, and its scoring radio cards draw a round indicator, distinct from the team button's square check). Week picker draws Wk 1 to Wk 18 and no All weeks button, and it is one tab stop: the selected week is tabindex 0, the others -1, and the Left and Right arrow keys move between weeks. 'What the numbers mean' closes the Picks section, after the last window and closed by default (Spread, O/U, FAV, Win probability), so the first team button stays in the first screen; the week buttons scroll inside their own box and the Previous and Next arrows stay outside it. Live cards (inside an expanded window; see the States sheet) carry the clock chip, Locked, down and distance, a full-width two-sided win probability row (ESPN's live figure, no Endzone Forecast credit; the leader in Accent, the trailer outlined Dim, one accessible name for both teams) and the league reveal tally.",
]);

const body = `<main style="max-width: 1280px; margin: 0 auto; padding: 24px 32px 64px; display: flex; flex-direction: column; gap: 24px">
${k.pkHead(LG)}
${k.commissionerPanel({ mode: 'straight' })}
${k.sectionsControl({ selected: 'picks' })}
${board}
${notes}
</main>`;
k.write(out, 'Pickem.dc.html', k.page({ title: "Pick'em, picks", w: 1440, h: 2514, body }));
console.log('ok');
