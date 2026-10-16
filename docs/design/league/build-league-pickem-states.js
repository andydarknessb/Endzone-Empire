// Pick'em states sheet (save on tap, Critique 10): off, per-card save states, rank swap, all saved, Perfect, errors, loading, empties, outcomes, expanded window and commissioner, plus the two Game Center empty states.
const k = require('./league-kit-pickem');
const out = process.argv[2];
const LG = 'Thursday Night Regulars';
const { px, FRAME2, h2s, frameHead, warn, btnGhost, SR } = k;

const cap = (t, sub) => `<div style="display: flex; flex-direction: column; gap: 2px; margin-bottom: 12px"><span style="font-size: 14px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase">${t}</span>${sub ? `<span style="font-size: 13px; color: {{t.dim}}">${sub}</span>` : ''}</div>`;
const section = (id, title, sub, inner) => `<section aria-labelledby="${id}" style="display: flex; flex-direction: column; min-width: 0"><div id="${id}">${cap(title, sub)}</div>${inner}</section>`;
const ARI = k.GAMES.find(g => g.key === 'ARI|SF'), DAL = k.GAMES.find(g => g.key === 'DAL|DEN');
const pad = (inner, g = 0) => `<div style="padding: 20px; display: flex; flex-direction: column; gap: ${g}px">${inner}</div>`;
const frame2 = (id, title, body) => `<section aria-labelledby="${id}" style="${FRAME2}; min-width: 0">${frameHead(h2s(id, title))}${body}</section>`;
const alertRow = text => `<div role="alert" style="display: flex; align-items: center; gap: 10px; font-size: 16px">${warn('{{t.danger}}')}${text}</div>`;
const sentence = (t, extra = '') => `<p style="margin: 0; font-size: 15px; color: {{t.dim}}; ${extra}">${t}</p>`;

// A. Pick'em is off (member)
const off = frame2('off-h', "Pick'em is off", pad(sentence("Your commissioner hasn't enabled Pick'em for this league yet. Ask them to switch it on and the whole league can start picking games.", 'max-width: 640px; text-wrap: pretty')));

// B. Save on tap: one card per state. Each card keeps its polite status region under the teams.
const cell = (label, sub, inner) => `<div style="display: flex; flex-direction: column; gap: 8px; min-width: 0">${cap(label, sub)}<div style="${FRAME2}">${inner}</div></div>`;
const kicked = k.gameCard(DAL, { my: null, total: 12, flaggedMsg: "This pick wasn't saved: DAL @ DEN had already kicked off. Your other picks are saved.", phase: 'locked' });
const saveStates = `<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px 20px; align-items: start">
${cell('Saving', "Tapped DEN: the team button is outlined (no fill, no check) and the line says 'Saving\u2026' in Dim; fill and check come only with 'Pick saved'.", k.gameCard(DAL, { my: 'DEN', total: 12, save: 'saving' }))}
${cell('Saved + Undo', "'Pick saved' with a pixel check and a ghost Undo for the change just made.", k.gameCard(ARI, { my: 'SF', total: 12, save: 'saved' }))}
${cell('Save failed + Retry', "Danger alert pictogram and words, a ghost Retry beside them, a 2px Danger edge; the attempted team is outlined, not filled.", k.gameCard(DAL, { my: 'DEN', total: 12, save: 'failed' }))}
${cell('Kicked off before save', "DAL @ DEN kicked off first, so the card draws Locked with a 2px Danger edge and the alert pictogram (the specimen's clock is Sun 3:31 PM).", kicked)}
</div>`;

// B2. Confidence: choosing a rank saves; a used rank stays in the menu and choosing it swaps the two games' ranks.
const USED = { 4: 'ARI @ SF', 7: 'DAL @ DEN', 9: 'PHI @ MIN', 13: 'SEA @ HOU', 14: 'KC @ LV' };
const AFTER = { ...USED, 4: 'DAL @ DEN', 7: 'ARI @ SF' };
const SP = Object.fromEntries(k.GAMES.map((g, i) => [g.key, k.SUNDAY_PICKED[i]])); // Sunday Pick'em: how many of its 10 managers picked each game
const LOCKED = Object.keys(USED).filter(r => k.isLockedGame(USED[r])).map(Number); // ranks held by a game that has kicked off at the board clock (2:40 PM)
const lockRow = (label, game) => `<div role="option" aria-selected="false" aria-disabled="true" style="display: flex; align-items: center; gap: 8px; min-height: 32px; padding: 0 12px; box-sizing: border-box; font-size: 15px; font-variant-numeric: tabular-nums; color: {{t.dim}}; cursor: not-allowed"><span style="width: 16px; flex: none; display: inline-flex">${k.lockIcon()}</span><span>${label} \u00b7 locked, ${game}</span></div>`;
const menuRow = (label, used, on, hot) => `<div role="option" aria-selected="${on}" style="display: flex; align-items: center; gap: 8px; min-height: 32px; padding: 0 12px; box-sizing: border-box; font-size: 15px; font-variant-numeric: tabular-nums; ${hot ? 'background: {{t.play}}; color: {{t.playInk}}; font-weight: 700' : 'color: {{t.ink}}'}"><span style="width: 16px; flex: none">${on ? k.check16() : ''}</span><span>${label}</span>${used ? `<span style="color: ${hot ? '{{t.playDim}}' : '{{t.dim}}'}">\u00b7 used by ${used}</span>` : ''}</div>`;
const menu = `<div role="listbox" aria-label="Confidence for ARI at SF, menu open" style="border: 2px solid {{t.ink}}; background: {{t.bg}}; box-sizing: border-box; padding: 4px 0; max-width: 360px"><div role="option" aria-selected="false" style="display: flex; align-items: center; gap: 8px; min-height: 32px; padding: 0 12px; font-size: 15px; color: {{t.dim}}"><span style="width: 16px; flex: none"></span>Confidence: none</div>${Array.from({ length: 14 }, (_, i) => LOCKED.includes(i + 1) ? lockRow(`Confidence ${i + 1}`, USED[i + 1]) : menuRow(`Confidence ${i + 1}`, USED[i + 1] && i + 1 !== 4 ? USED[i + 1] : '', i + 1 === 4, i + 1 === 7)).join('')}</div>`;
const swapCards = `<div style="${FRAME2}">${k.gameCard(ARI, { mode: 'confidence', my: 'SF', conf: 7, total: 10, n: SP[ARI.key], save: 'saved', swap: 'DAL @ DEN', usedRanks: AFTER })}<div style="border-top: 2px solid {{t.rule}}"></div>${k.gameCard(DAL, { mode: 'confidence', my: 'DEN', conf: 4, total: 10, n: SP[DAL.key], save: 'saved', swap: 'ARI @ SF', usedRanks: AFTER })}</div>`;
const swap = `<div style="display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 20px; align-items: start"><div style="display: flex; flex-direction: column; gap: 8px; min-width: 0">${cap('After choosing 7 for ARI @ SF', "Sunday Pick'em (10 managers). Both games saved: ARI @ SF is now 7, DAL @ DEN is now 4.")}${swapCards}</div><div style="display: flex; flex-direction: column; gap: 8px">${cap('The menu before choosing', 'Used ranks stay choosable, marked with their game; choosing one swaps. Ranks 9 and 13 belong to games that kicked off: locked, not choosable.')}${menu}</div></div>`;

// B2b. 409: choosing a rank a kicked-off game holds is refused; the card keeps its rank.
const REFUSED = LOCKED[0];
const locked409 = `<div style="max-width: 920px"><div style="${FRAME2}">${k.gameCard(ARI, { mode: 'confidence', my: 'SF', conf: 4, total: 10, n: SP[ARI.key], save: 'refused', saveMsg: `Rank ${REFUSED} is locked to ${USED[REFUSED]}. Choose another rank.`, usedRanks: USED })}</div></div>`;

// B3. 14 of 14 picked: the one status place says so.
const allSaved = `<div style="${FRAME2}; padding: 14px 20px; display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 16px">${h2s('all-h', 'Picks')}<span style="font-size: 16px; font-variant-numeric: tabular-nums">${k.statusWords({ picked: 14, total: 14 })}</span></div>`;

// B4. Perfect: a final window where every pick was right (8 of 8), next to a one-game window, which never earns it.
const earlyAll = k.GAMES.filter(g => g.win === 'sunday-early').map(g => ({ ...g, ph: 'final', fin: { as: 17, hs: 24, head: '' } }));
const perfectSummary = k.windowSummary(earlyAll, () => 'final', g => g.home);
const thu = k.GAMES.filter(g => g.win === 'thursday-night');
const perfect = `<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; align-items: start">${k.windowFrame({ id: 'w-perf', title: 'Sunday Early', summary: perfectSummary })}${k.windowFrame({ id: 'w-thu', title: 'Thursday Night', summary: k.windowSummary(thu, g => g.ph, g => k.MY_PICKS[g.key]) })}</div>`;

// C. Errors
const errBox = (msg, retry, testid) => `<div role="alert" data-testid="${testid}" style="border: 6px double {{t.danger}}; background: {{t.panel}}; padding: 16px 20px; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px 20px"><div style="display: flex; gap: 12px; align-items: center; min-width: 0">${warn('{{t.danger}}')}<span style="font-size: 16px">${msg}</span></div>${btnGhost(retry)}</div>`;
const boardErr = `<div style="display: flex; flex-direction: column; gap: 16px">${k.weekStrip({ week: 7 })}${errBox("We could not load this week's picks right now.", 'Retry', 'pickem-board-error')}</div>`;
const errors = `<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; align-items: start"><div style="display: flex; flex-direction: column; gap: 16px">${cap('Board', 'Under the week picker; Retry reloads the week.')}${boardErr}</div><div style="display: flex; flex-direction: column; gap: 16px">${cap('Page', 'Replaces the body; the head and breadcrumb stay.')}${errBox("We could not load this league. Check your connection and try again.", 'Retry', 'pickem-page-error')}</div></div>`;

// D. Loading skeletons
const loading = `<div aria-busy="true" data-testid="pickem-page-loading" style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; align-items: start">${[0, 1].map(() => `<div style="${FRAME2}">${frameHead(k.skel('180px', 20))}${k.skelCard()}</div>`).join('')}</div>`;

// E. Empty
const empties = `<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; align-items: start">${frame2('em1', 'Picks', pad(`<p data-testid="pickem-board-empty" style="margin: 0; font-size: 16px; font-weight: 600">No games scheduled for week 8.</p>`))}${frame2('em2', 'Picks', pad(`<p style="margin: 0; font-size: 16px; font-weight: 600">No week selected.</p>`))}</div>`;

// G2. Final outcomes: Missed lives here because no Sunday game is final yet. JAX @ LAR as it would read Final.
const JAXG = k.GAMES.find(g => g.key === 'JAX|LAR');
const final = { ...JAXG, ph: 'final', fin: { as: 20, hs: 27, head: 'Rams run out the clock on a 9-play drive to beat Jacksonville 27-20.' } };
const chips = `<div style="display: flex; flex-wrap: wrap; gap: 12px">${['Correct', 'Correct · +5', 'Missed · picked JAX', 'Tie · no credit', 'No pick'].map(k.outcomeChip).join('')}</div>`;
const outcomes = `<div style="display: flex; flex-direction: column; gap: 16px; max-width: 920px">${chips}<div style="${FRAME2}">${k.gameCard(final, { my: 'JAX', total: 12 })}</div></div>`;

// G3. A settled window expanded: the summary row stays, the control reads Hide games, and the live cards (with the win probability row) are drawn.
const early = k.GAMES.filter(g => g.win === 'sunday-early'), phaseOf = g => g.ph, pickOf = g => k.MY_PICKS[g.key];
const expanded = `<div style="max-width: 920px">${k.windowFrame({ id: 'w-exp', title: 'Sunday Early', summary: k.windowSummary(early, phaseOf, pickOf), expanded: true, cards: ['JAX|LAR', 'NYJ|CIN'].map(key => k.gameCard(early.find(g => g.key === key), { total: 12 })) })}</div>`;

// G4. Commissioner settings expanded (Edit pressed): the switch is usable, the scoring cards are disabled and the product's reason shows.
const csOpen = `<div style="max-width: 920px">${k.commissionerPanel({ mode: 'straight', expanded: true, id: 'cs-x' })}</div>`;

// G5. Rank strip: three ranks used (14, 13, 9), the sticky strip of the Picks section in confidence mode.
const ranks = `<div style="max-width: 1000px; display: flex; flex-direction: column; gap: 12px"><p style="margin: 0; font-size: 16px; max-width: 760px; text-wrap: pretty">${k.RULE()}</p>${k.rankStrip({ used: [14, 13, 9], locked: LOCKED })}</div>`;

// H. Game Center empty states, small, tertiary frame, Archivo copy
const gc = `<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; align-items: start">${frame2('gc1', 'Scoring feed', pad(sentence('Live scoring plays will appear here once games kick off.', 'text-wrap: pretty')))}${frame2('gc2', 'League matchups', pad(sentence('No other league matchups this week.')))}</div>`;

const notes = k.notes([
  "Save on tap (Critique 10, a product change for spec #2334): choosing a team saves that pick at once, so the sheet has no batch-save button, no dirty state, no dashed edge, no leave-confirmation dialog and no bottom bar. Every open card carries a status line under its teams, empty at rest, and that line alone is a polite live region (role=status): it holds the words only, and the ghost Undo and Retry buttons sit beside it, outside the region, so a tap makes one announcement (the Picks h2 status and the rank strip's words are plain text). Saving: 'Saving\u2026' in Dim, and the chosen team button is outlined in Play-blue (a 4px edge, no fill) with an empty square and 'Pick' instead of the check: saving is not saved. Saved: the fill and the pixel check arrive with 'Pick saved' and a ghost 'Undo' that restores the previous pick (or no pick). Failed: the alert pictogram and 'Couldn't save this pick.' in Danger, a ghost 'Retry' (aria-label 'Retry saving pick, DAL at DEN') and the attempted team still outlined, so a refused pick never looks saved. A failed or kicked-off card wears a 2px Danger edge and the alert pictogram; the 4px frame belongs to the cursor alone. Locked games cannot change.",
  "Team buttons are named '{ABBR}, {Team} over {Opponent}, {day time}{, locks in n min}', so the name starts with the visible abbreviation (for example 'KC, Kansas City Chiefs over Las Vegas Raiders, Sun 3:25 PM, locks in 45 min'), and add the state where it matters: 'saving', 'saved' or 'not saved, retry' (the one place those words survive, in an accessible name). Kicked off before save: the card is drawn Locked (lock icon, Locked chip, kickoff past) with a 2px Danger edge and the alert line 'This pick wasn't saved: DAL @ DEN had already kicked off. Your other picks are saved.'; no team is filled, since nothing was saved.",
  "Confidence saves on tap too. Choosing a rank saves it. A rank another game holds stays in the menu (the native option text reads 'Confidence 7 \u00b7 used by DAL @ DEN'; the open menu is drawn as a listbox mirror, the highlighted option in Play-blue, the current value checked). Choosing a used rank swaps the two games' ranks, both saved, and each card says 'Swapped with {the other game}' with 'Both ranks saved' and a ghost 'Undo swap'; the specimen's tally uses Sunday Pick'em's real size, 10 managers. A rank held by a game that has kicked off cannot be swapped (Critique 11): its option reads 'Confidence 9 \u00b7 locked, PHI @ MIN' (disabled in the native select, aria-disabled in the listbox mirror, dimmed with a lock, never highlighted) and its rank-pool cell carries a small lock above the number; if a stale menu still sends it, the server answers 409 and the card says 'Rank 9 is locked to PHI @ MIN.' with 'Choose another rank.' (Danger edge, no Retry, rank unchanged). The locked state is derived from the Week 7 slate at the specimen's 2:40 PM clock. The sticky rank strip ('11 ranks left' and 14 cells, used ranks filled and numbered) is drawn once here with ranks 14, 13 and 9 used; PickemConfidence shows it live.",
  "All picked: the one status place, the Picks h2 row, reads '14 of 14 picked \u00b7 all saved' with a pixel check (no open count, no next lock), as plain text. Perfect (item 6): a final window where every pick was right reads 'Final \u00b7 8 of 8 correct' with a small pixel star and the word 'Perfect' (the star is aria-hidden, the word carries it). Decision: Perfect needs two or more games, every one picked and right, so Pickem's Thursday window stays 'Final \u00b7 1 of 1 correct' (drawn beside it): a single game is not an ending that earns a star. Correct chips stay outlined Ink.",
  "Errors use the Danger double rule and the warning icon with the product's sentence, each with a ghost Retry: the board error 'We could not load this week's picks right now.' (Retry reloads the week) and the page error \"We could not load this league. Check your connection and try again.\" The two earlier page variants (league read, settings read) collapse into that one copy. Skeletons are square Skel blocks, no animation. Empty states keep the Picks frame; Game Center's two empties use the same tertiary frame as the Game Center boards.",
  "Window expanded: a settled window is one summary row ('8 live \u00b7 5 picked \u00b7 3 no pick') with 'Show games'; pressed, the control reads 'Hide games' (aria-expanded true) and the cards draw. The live card shows the win probability as one full-width two-sided bar: away share from the left, home from the right, leader in Accent and bold at its end, trailer outlined Dim, one accessible name naming both teams. Open windows carry 'League picks reveal at kickoff' once in their head (not drawn on these two live cards).",
  "Commissioner settings expanded (Edit pressed, aria-expanded true): the Pick'em switch stays usable, both Scoring cards are disabled with no opacity and draw a round indicator (a ring, with a dot in the selected card), distinct from the team button's square check; the selected Straight up card keeps its full Play-blue fill and adds the lock icon and the word Locked; the other card is solid Dim text. The product's reason 'The mode can only change before the season's first pick.' stays beside the disabled Save scoring mode (a solid Rule edge, Dim text). The collapsed row reads 'Edit' and expanded 'Hide'; in a pick'em-only league the row drops 'Pick'em on' (see PickemConfidence). Week picker: the week buttons scroll sideways inside their own box and the Previous and Next arrows sit outside it; one tab stop (selected week tabindex 0, arrow keys move the week). 'What the numbers mean' (the last thing in the Picks section) is drawn open below, with every entry.",
]);

const body = `<main style="max-width: 1236px; margin: 0 auto; padding: 40px 32px 64px; display: flex; flex-direction: column; gap: 48px; box-sizing: content-box">
<header style="display: flex; flex-direction: column; gap: 12px">${k.h1("Pick'em states")}<p style="margin: 0; font-size: 17px; color: {{t.dim}}">${LG} \u00b7 off, save on tap (saving, saved, failed, kicked off), rank swap, locked rank, all saved, Perfect, errors, loading, empties, outcomes, Game Center empties</p></header>
${section('s-a', "Pick'em is off", 'Member view. The head and breadcrumb are unchanged.', off)}
${section('s-b', 'Save on tap', 'Each state of a card the viewer just tapped. The Picks h2 row stays the one status place.', saveStates)}
${section('s-b2', 'Rank swap', 'Confidence: choosing a rank saves it; choosing a rank another game holds swaps the two.', swap)}
${section('s-b2b', 'Rank locked', `Sunday Pick'em. Choosing rank ${REFUSED} for ARI @ SF is refused: ${USED[REFUSED]} has kicked off, so the rank cannot move. The card keeps rank 4 and says why; there is no Retry.`, locked409)}
${section('s-b3', 'All picked', 'Every game picked: the Picks h2 row says so.', allSaved)}
${section('s-b4', 'Perfect window', 'Every pick in a final window was right: a pixel star and the word Perfect. A one-game window never earns it.', perfect)}
${section('s-c', 'Errors', 'A failed week read and a failed league read; both offer Retry.', errors)}
${section('s-d', 'Loading', 'One skeleton card per state while the week loads.', loading)}
${section('s-e', 'Empty', 'No games for the week; no week selected.', empties)}
${section('s-g2', 'Final outcomes', "The Missed chip reads 'Missed · picked {team}', a result word in an outlined Ink chip, never red; Correct · +n is the confidence-mode form.", outcomes)}
${section('s-g3', 'Window expanded', 'Show games pressed: Sunday Early keeps its summary row, the control becomes Hide games, and the live cards draw (two of the eight shown).', expanded)}
${section('s-g4', 'Commissioner settings expanded', 'Edit pressed: the Pick\'em switch stays usable, the Scoring cards are disabled, and the reason says why.', csOpen)}
${section('s-g5', 'Rank strip', 'Ranks 14, 13 and 9 are used (filled, numbered); 13 and 9 belong to kicked-off games, so their cells carry a small lock; the other eleven are free (outlined). It sticks to the top of the Picks section on confidence boards.', ranks)}
${section('s-g6', 'What the numbers mean', 'Closed by default on the Picks tab; drawn open here with the Confidence entry (confidence boards only).', k.pkHelp({ confidence: true, open: true }))}
${section('s-h', 'Game Center empties', 'Scoring feed before kickoff, and a week with no other matchups.', gc)}
${notes}
</main>`;
k.write(out, 'PickemStates.dc.html', k.page({ title: "Pick'em states", w: 1300, h: 4871, body }));
console.log('ok');
