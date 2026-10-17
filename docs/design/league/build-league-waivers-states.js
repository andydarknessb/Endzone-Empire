// Waivers states sheet (1300): summary variants, claim sheets, phone My claims tab and filters drawer, empties, errors, loading, toasts.
const k = require('./league-kit-waivers');
const out = process.argv[2];
const LG = 'Thursday Night Regulars';
const { FRAME, FRAME2, px, h2s, frameHead, warn, btnGhost, byName } = k;

const cap = (t, sub) => `<div style="display: flex; flex-direction: column; gap: 2px; margin-bottom: 12px"><span style="font-size: 14px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase">${t}</span>${sub ? `<span style="font-size: 13px; color: {{t.dim}}; text-wrap: pretty">${sub}</span>` : ''}</div>`;
const section = (id, title, sub, inner) => `<section aria-labelledby="${id}" style="display: flex; flex-direction: column; min-width: 0"><div id="${id}">${cap(title, sub)}</div>${inner}</section>`;
const cell = (label, sub, inner) => `<div style="display: flex; flex-direction: column; min-width: 0">${cap(label, sub)}${inner}</div>`;
const grid2 = inner => `<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px 20px; align-items: start">${inner}</div>`;
const frame2 = (id, title, body) => `<section aria-labelledby="${id}" style="${FRAME2}; min-width: 0">${frameHead(h2s(id, title))}${body}</section>`;
const msg = t => `<p style="margin: 0; padding: 20px; font-size: 16px; font-weight: 600">${t}</p>`;
const errBox = (text, retry) => `<div style="border: 2px solid {{t.danger}}; background: {{t.panel}}; padding: 16px 20px; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px 20px"><div role="alert" style="display: flex; gap: 12px; align-items: center; min-width: 0">${warn('{{t.danger}}')}<span style="font-size: 16px">${text}</span></div>${btnGhost(retry)}</div>`;

// A. summary variants
const prioTiles = [
  { label: 'Next claim resolves', value: 'None', note: 'No pending claims' },
  { label: 'Waiver priority', value: '#5', note: 'Your place in line.' },
  { label: 'Roster', value: '13/15', note: '' },
];
const nowTiles = [
  { label: 'Next claim resolves', value: 'Clearing now', note: 'Waivers clear Wed 2:00 AM' },
  { label: 'FAAB left', value: '$62', note: '$19 bid on 2 pending claims' },
  { label: 'Waiver priority', value: 'TBD', note: 'Breaks equal bids. A win sends you to the back.' },
  { label: 'Roster', value: '15/15', chip: k.fullChip(), note: 'Every claim needs a drop.' },
];
const sums = `<div style="display: flex; flex-direction: column; gap: 20px">
${cell('Priority league (not FAAB), room on the roster', 'No FAAB tile; the roster tile has no chip and no note; the sub-line drops "FAAB league".', k.summary({ tiles: prioTiles }).replace('id="ws-h"', 'id="ws-h2"').replace('aria-labelledby="ws-h"', 'aria-labelledby="ws-h2"'))}
${cell('Nothing pending, FAAB', 'The countdown reads None; note "No pending claims".', k.summary({ tiles: [{ label: 'Next claim resolves', value: 'None', note: 'No pending claims' }, { label: 'FAAB left', value: '$81', note: '$0 bid on 0 pending claims' }, { label: 'Waiver priority', value: '#5', note: 'Breaks equal bids. A win sends you to the back.' }, { label: 'Roster', value: '15/15', chip: k.fullChip(), note: 'Every claim needs a drop.' }] }).replace(/ws-h/g, 'ws-h3'))}
${cell('Clear time passed, priority not set', '"Clearing now" when the instant has arrived; "TBD" when the league has not set a priority.', k.summary({ tiles: nowTiles }).replace(/ws-h/g, 'ws-h4'))}
</div>`;

// A2. Under one hour: the only place Danger shows. Specimen clock Wed 1:20 AM, 40 minutes before the weekly clear.
const soon = k.atRem(k.CURSOR, 40);
const soonTiles = [{ label: 'Next claim resolves', ...k.tileTime(40), note: k.clearNote }, { label: 'FAAB left', value: '$62', note: '$19 bid on 2 pending claims' }, { label: 'Waiver priority', value: '#5', note: 'Breaks equal bids. A win sends you to the back.' }, { label: 'Roster', value: '15/15', chip: k.fullChip(), note: 'Every claim needs a drop.' }];
const underHour = `<div style="display: flex; flex-direction: column; gap: 20px">${k.summary({ tiles: soonTiles }).replace(/ws-h/g, 'ws-h5')}<section aria-labelledby="uh-h" style="${FRAME2}">${frameHead(h2s('uh-h', 'Players'))}${k.wvTable({ rows: [soon], cursor: soon, expanded: null, detail: '' })}</section></div>`;

// A3. Best ball: no Upgrade, so no cursor and no filled action; every Claim is a ghost.
const bb = [k.byName('Rashid Shaheed'), k.byName('Michael Wilson'), k.byName('Jaylen Wright')];
const noCursor = `<section aria-labelledby="bb-h" style="${FRAME2}">${frameHead(h2s('bb-h', 'Players'))}${k.wvTable({ rows: bb, cursor: null, expanded: null, detail: '', bestBall: true })}</section>`;

// B. claim sheets
const W = byName('Michael Wilson'), S = byName('Rashid Shaheed');
const T = { verb: 'Claim', name: 'Michael Wilson' };
const sheets = `<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 480px)); gap: 28px 24px; justify-content: space-between; align-items: start">
${cell('Roster full, no drop chosen', 'At capacity the list has no "No drop" row and nothing is preselected here, so Submit claim is disabled (solid Rule edge, Dim text).', k.claimSheet({ id: 'cs1', ...T, p: W, dropped: null, bid: '0' }))}
${cell('Drop chosen, bid set', "The server's suggested drop arrives preselected: Tyler Allgeier, the lowest Rest of season player not on IR. Submit claim is the modal's filled action.", k.claimSheet({ id: 'cs2', ...T, p: W, dropped: 'Tyler Allgeier', bid: '14' }))}
${cell('Invalid bid', "A whole-dollar bid between $0 and $62 or Submit stays disabled; the field takes a 2px Danger edge and the alert line.", k.claimSheet({ id: 'cs3', ...T, p: W, dropped: 'Tyler Allgeier', bid: '70', bidError: true }))}
${cell('Edit claim', "Opens prefilled; the claim's own $14 is already held, so $76 remains. The button reads Save claim; Claim order is the server's to keep.", k.claimSheet({ id: 'cs4', verb: 'Edit claim', name: 'Rashid Shaheed', p: S, dropped: 'Tyler Allgeier', bid: '14', remaining: 76, edit: true }))}
${cell('Priority league, room on the roster', 'Drop is optional with a "No drop" row selected; no bid, so the sheet shows "Waiver priority #5".', k.claimSheet({ id: 'cs5', ...T, p: W, dropped: null, atCap: false, priority: 5 }))}
${cell('Phone: full screen below 600px', 'The same sheet fills the screen; the list scrolls inside its own box, and the 44px stepper, $1 and Max stay on one wrapped row.', `<div style="border: 2px solid {{t.rule}}; width: 390px; box-sizing: border-box; padding: 0">${k.claimSheet({ id: 'cs6', ...T, p: W, dropped: 'Tyler Allgeier', bid: '14', phone: true, rows: 4 })}</div>`)}
</div>`;

// C. phone: My claims tab, filters drawer, empty claims
const phoneBox = inner => `<div style="width: 390px; box-sizing: border-box; border: 2px solid {{t.rule}}; padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 16px">${inner}</div>`;
const drawer = `<section aria-labelledby="pf-h" style="${FRAME}; box-sizing: border-box; display: flex; flex-direction: column"><div style="padding: 12px 14px; border-bottom: 2px solid {{t.rule}}"><h2 id="pf-h" style="margin: 0; ${px(16)}">Player filters</h2></div><div style="padding: 16px; display: flex; flex-direction: column; gap: 14px">${k.select({ id: 'pf-pos', label: 'Position', options: ['All', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'], value: 'All' })}${k.select({ id: 'pf-bye', label: 'Bye week', options: ['Any', 'Wk 8'], value: 'Any' })}${k.checkbox({ id: 'pf-w', label: 'Watching' })}<div style="display: flex; align-items: flex-end; gap: 8px"><div style="flex: 1">${k.select({ id: 'pf-sort', label: 'Sort', options: ['Upgrade'], value: 'Upgrade' })}</div>${k.sortDir()}</div></div><div style="display: flex; justify-content: flex-end; padding: 12px 16px; border-top: 2px solid {{t.rule}}">${btnGhost('Done')}</div></section>`;
const phones = `<div style="display: grid; grid-template-columns: repeat(3, 390px); gap: 20px; justify-content: space-between; align-items: start">
${cell('My claims tab', 'The aside as a tab: pending claims with 44px icon buttons, the one shared-drop note, Week 6 and earlier results, and Bye clusters.', phoneBox(`${k.viewControl({ selected: 'claims' })}${k.claimsFrame({ phone: true })}${k.byeFrame({ phone: true })}`))}
${cell('Player filters drawer', 'Filters opens it from the bottom; Done closes it. The controls are the desktop row, stacked.', phoneBox(`${k.viewControl({ selected: 'waivers' })}${drawer}`))}
${cell('My claims tab, empty', '"No claims yet" with the tab control; below it the read error "Your claims could not be loaded."', phoneBox(`${k.viewControl({ selected: 'claims' })}${k.claimsFrame({ pending: [], results: [], phone: true })}${k.claimsFrame({ error: true, phone: true }).replace('id="mc-h"', 'id="mc-h2"').replace('aria-labelledby="mc-h"', 'aria-labelledby="mc-h2"')}`))}
</div>`;

// D. empties
const pagerCap = c => `<div style="display: flex; justify-content: center; padding: 0 16px 16px; font-size: 13px; color: {{t.dim}}">${c}</div>`;
const empties = grid2(`${cell('No players on waivers', 'The pool is empty (the page shows 0 players).', frame2('e1', 'Players', msg('No players are on waivers') + pagerCap('0 players')))}
${cell('Search with no match', 'A search that matches nothing.', frame2('e2', 'Players', msg('No players matching “zzz”') + pagerCap('0 players matching “zzz”')))}
${cell('Watching with nothing on the page', 'Watching is on and no watched player is on this page.', frame2('e3', 'Players', msg('No watched players on this page') + pagerCap('14 players')))}
${cell('No players found', 'Any other empty result.', frame2('e4', 'Players', msg('No players found') + pagerCap('0 players')))}
${cell('No claims yet', 'The My claims card before the first claim.', k.claimsFrame({ pending: [], results: [] }).replace(/mc-h/g, 'mc-h5'))}
${cell('Claims read failed', 'Only the card changes; the list stays.', k.claimsFrame({ error: true }).replace(/mc-h/g, 'mc-h6'))}
${cell('A claim that did not go through', 'Result head "Didn\'t go through" with the server\'s reason in text under it.', k.claimsFrame({ pending: [], results: [{ week: 'Week 6', rows: [['Jaylen Warren', "Didn't go through", 'Your roster was full and no drop was set.']] }] }).replace(/mc-h/g, 'mc-h7'))}`);

// E. errors
const errs = `<div style="display: flex; flex-direction: column; gap: 24px">${cell('League read failed', 'Replaces the body under the head. Retry is the one label for both errors.', errBox('We could not load this league. Check your connection and try again.', 'Retry'))}
${cell('Player list read failed', 'Under the summary; Retry re-reads the pool.', errBox('We could not load the players. Check your connection and try again.', 'Retry'))}</div>`;

// F. loading
const skelRow = i => `<div style="display: grid; grid-template-columns: 236px 92px 64px 104px 96px 130px 150px 132px; gap: 0; align-items: center; padding: 12px 10px; ${i ? 'border-top: 2px solid {{t.rule}}' : ''}">${['160px', '40px', '40px', '40px', '50px', '90px', '100px', '80px'].map(w => `<span style="padding: 0 10px">${k.skel(w, 20)}</span>`).join('')}</div>`;
const loading = `<div aria-busy="true" style="max-width: 1236px"><p role="status" style="margin: 0 0 12px; font-size: 14px; color: {{t.dim}}">Loading players</p><div style="${FRAME}">${frameHead(k.skel('140px', 24))}${[0, 1, 2, 3].map(skelRow).join('')}</div></div>`;

// G. toasts
const toast = (t, { undo = false, err = false } = {}) => `<div style="${err ? 'border: 2px solid {{t.danger}}' : 'border: 2px solid {{t.ink}}'}; background: {{t.panel}}; padding: 8px 8px 8px 16px; min-height: 60px; box-sizing: border-box; display: flex; align-items: center; justify-content: space-between; gap: 16px; font-size: 15px; font-weight: 600"><span role="status" style="display: flex; align-items: center; gap: 10px">${err ? warn('{{t.danger}}') : ''}${t}</span>${undo ? btnGhost('Undo') : ''}</div>`;
const toasts = `<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 20px; align-items: start">${toast('Waiver claim submitted')}${toast('Waiver claim updated')}${toast('Claim on Rashid Shaheed cancelled', { undo: true })}${toast('Claim on Rashid Shaheed restored')}<div style="display: flex; flex-direction: column; gap: 4px"><span style="font-size: 13px; color: {{t.dim}}">Announced only, not drawn: the polite live region after a move</span><span style="font-size: 15px; font-weight: 600">Jalen McMillan moved to Claim order #1</span></div></div>`;

const notes = k.notes([
  `Claim sheet: a dialog from 600px up, full screen below. Swap preview, Drop a player, the FAAB bid row (44px Lower bid, Bid, Raise bid, $1, Max) and "$N remaining" are the product's; Submit claim is the one filled action in the modal. Disabled Submit uses a solid Rule edge and Dim text (never dashed: dashed means unsaved elsewhere). Radios draw a round indicator. The invalid-bid error keeps the product copy and adds the alert pictogram; the field takes a 2px Danger edge.`,
  `Drop list: roster_limit 15 and ir_slots 1 (the 15 includes the IR player). The list sorts lowest Proj Wk first; the suggested drop is Tyler Allgeier, the lowest Rest of season player who is not on IR (dropSuggestionFor excludes IR). The list scrolls inside its own box and is cut mid-row so the scroll reads (dropSuggestionFor, playersPage.service.js:265-288). Max would bid $62. The swap preview is the later-week form ('Wk 9 swap', '+2.4 Wk 9'), and there is none when a claim would fill an empty slot. Focus: the sheet opens on its first control, closes to the row's Claim or 'Claim #n', and announces 'Waiver claim submitted' once. Claims #1 and #2 both drop Tyler Allgeier, which is why the My claims card carries the shared-drop note.`,
  `Error copy follows 'We could not load ...'; the player-list message is a copy decision (the product shows the server's text). Retry on the league error and the single shared-drop note are product changes for the spec. Server refusals on submit (a stale bid, a closed window) arrive as the server's own text in an error toast and are not drawn. No filled action exists outside the claim sheet.`,
]);

const body = `<main style="max-width: 1236px; margin: 0 auto; padding: 40px 32px 64px; display: flex; flex-direction: column; gap: 48px; box-sizing: content-box">
<header style="display: flex; flex-direction: column; gap: 12px">${k.h1('Waivers states')}<p style="margin: 0; font-size: 17px; color: {{t.dim}}">${LG} · summary variants, claim sheets, phone tab and filters, empties, errors, loading, toasts</p></header>
${section('s-a', 'Summary strip', 'Priority league, nothing pending, and a clear time that has arrived. Figures are Pixel 24; Full is a word chip.', sums)}
${section('s-a2', 'Under one hour to the clear', 'Specimen clock Wed 1:20 AM, 40 minutes before the weekly clear. Danger text and the clock icon appear on the Status line, and the cursor frame turns Danger when the cursor row clears in under an hour; the next-claim figure stays Ink. The Week 7 boards have no row under an hour.', underHour)}
${section('s-a3', 'No cursor (best ball)', 'A best ball league has no Upgrade, so the column is hidden, the page has no cursor and no filled action, and every Claim is a ghost. The same holds when no row has a positive Upgrade.', noCursor)}
${section('s-b', 'Claim sheet', 'Roster full (Week 7, Darkness Falls), the edit sheet, a priority league, and the phone full-screen sheet. The title is "Claim" in Pixel 16 and the player name in Archivo 24 700.', sheets)}
${section('s-c', 'Phone: My claims, filters, empty', 'Below md the aside becomes the My claims tab and the filters become a drawer.', phones)}
${section('s-d', 'Empty', 'The four list empties, and the claims card before any claim and when its read fails.', empties)}
${section('s-e', 'Errors', 'A 2px Danger edge, the warning icon and the product sentence, each with a ghost Retry inside the alert.', errs)}
${section('s-f', 'Loading', 'A status line and square skeleton rows, no animation.', loading)}
${section('s-g', 'Toasts', 'The strings are the product\'s own; Undo is a ghost button.', toasts)}
${notes}
</main>`;
k.write(out, 'WaiversStates.dc.html', k.page({ title: 'Waivers states', w: 1300, h: 8307, body }));
console.log('ok');
