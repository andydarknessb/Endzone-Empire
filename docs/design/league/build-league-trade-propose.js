// Propose Trade / Counter Trade dialogs: desktop with analysis, phone full-screen, empty and deep-link entries, Counter variant. Viewer: Darkness Falls, Sunday 9:10 AM CDT.
const k = require('./league-kit-trades');
const out = process.argv[2];

const cap = (t, sub) => `<div style="display: flex; flex-direction: column; gap: 2px; margin-bottom: 12px"><span style="font-size: 14px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase">${t}</span>${sub ? `<span style="font-size: 13px; color: {{t.dim}}; max-width: 90ch; text-wrap: pretty">${sub}</span>` : ''}</div>`;
const section = (id, title, sub, inner) => `<section aria-labelledby="${id}" style="display: flex; flex-direction: column; min-width: 0"><div id="${id}">${cap(title, sub)}</div>${inner}</section>`;
const scrim = inner => `<div style="background: {{t.scrim}}; padding: 32px; box-sizing: border-box">${inner}</div>`;
const names = a => a.map(p => p.name);

// Ghosts' roster (Counter's "You receive" column): QB 1, RB 2, WR 4, TE 1, K 1, DEF 1, as GHOSTS_POS reads it.
const mk = (name, pos, nfl, wk, ros) => ({ name, pos, nfl, wk, ros });
const GHOSTS_ROSTER = [mk('Jayden Daniels', 'QB', 'WAS', 18.3, 201.3), mk('Bucky Irving', 'RB', 'TB', 12.6, 138.6), mk('Kyren Williams', 'RB', 'LAR', 13.4, 147.4), k.WILSON, mk('Courtland Sutton', 'WR', 'DEN', 12.4, 136.4), mk('Tee Higgins', 'WR', 'CIN', 11.9, 130.9), mk('Jerry Jeudy', 'WR', 'CLE', 8.4, 92.4), mk('George Kittle', 'TE', 'SF', 11.7, 128.7), mk('Jake Bates', 'K', 'DET', 8.2, 90.2), mk('Lions', 'DEF', 'DET', 6.8, 74.8)];
if (k.posOf(GHOSTS_ROSTER).join() !== k.GHOSTS_POS.join()) throw new Error('GHOSTS_ROSTER positions drifted from GHOSTS_POS');

// A. desktop, the dialog with analysis (opened from the header, then team, then players)
const desktop = scrim(k.tradeDialog({ id: 'pd', title: 'Propose Trade', teamSelect: k.teamSelect({ id: 'pd-with', value: 'Dynasty Dads' }),
  send: k.rosterColumn({ label: 'You send', players: k.DF, checked: names(k.P_SEND), testId: 'roster-column-send' }),
  receive: k.rosterColumn({ label: 'You receive', players: k.DADS, checked: names(k.P_RECV), testId: 'roster-column-receive' }),
  res: k.P_RES, sendNames: names(k.P_SEND), receiveNames: names(k.P_RECV), canSend: true }));

// B. phone full-screen, same trade; beside it the empty dialog and the deep-link entry
const phone = `<div style="width: 390px; flex: none">${k.tradeDialog({ id: 'pp', phone: true, title: 'Propose Trade', teamSelect: k.teamSelect({ id: 'pp-with', value: 'Dynasty Dads' }),
  send: k.rosterColumn({ label: 'You send', players: k.DF, checked: names(k.P_SEND), testId: 'roster-column-send', phone: true }),
  receive: k.rosterColumn({ label: 'You receive', players: k.DADS, checked: names(k.P_RECV), testId: 'roster-column-receive', phone: true }),
  res: k.P_RES, sendNames: names(k.P_SEND), receiveNames: names(k.P_RECV), canSend: true })}</div>`;
const empty = k.tradeDialog({ id: 'pe', title: 'Propose Trade', teamSelect: k.teamSelect({ id: 'pe-with', value: '' }), canSend: false });
const deep = k.tradeDialog({ id: 'pl', title: 'Propose Trade', teamSelect: k.teamSelect({ id: 'pl-with', value: 'Dynasty Dads' }),
  send: k.rosterColumn({ label: 'You send', players: k.DF, checked: [], testId: 'roster-column-send' }),
  receive: k.rosterColumn({ label: 'You receive', players: k.DADS, checked: ['Malik Nabers'], testId: 'roster-column-receive' }),
  sendNames: [], receiveNames: ['Malik Nabers'], canSend: false });
const side = `<div style="display: flex; flex-direction: column; gap: 32px; min-width: 0; flex: 1">
<div>${cap('Opened from Propose Trade', "Nothing chosen: 'Trade with' is empty, no columns, Send Offer disabled (a solid Rule edge, Dim text).")}${empty}</div>
<div>${cap('Opened from a player row (deep link)', "The Players row 'Trade' action links here with ?receivingTeamId= and ?playerId=: the team is preselected and the player is checked under You receive; params are then stripped. Nothing under You send yet, so Send Offer stays disabled and no analysis runs.")}${deep}</div>
</div>`;
const phoneRow = `<div style="display: flex; align-items: flex-start; gap: 24px">${phone}${side}</div>`;

// C. Counter: the incoming Ghosts offer inverted, Trade with disabled
const counter = scrim(k.tradeDialog({ id: 'pc', title: 'Counter Trade', teamSelect: k.teamSelect({ id: 'pc-with', value: 'Gridiron Ghosts', disabled: true }),
  send: k.rosterColumn({ label: 'You send', players: k.DF, checked: names(k.A_SEND), testId: 'roster-column-send' }),
  receive: k.rosterColumn({ label: 'You receive', players: GHOSTS_ROSTER, checked: ['Garrett Wilson'], testId: 'roster-column-receive' }),
  res: k.C_RES, sendNames: names(k.A_SEND), receiveNames: ['Garrett Wilson'], canSend: true }));

// D. Send Offer refused: the server's sentence lands inside the dialog (today it goes to the page Alert and a toast behind the modal, TradeCenter.jsx:388-391)
const refused = scrim(k.tradeDialog({ id: 'pr', title: 'Propose Trade', teamSelect: k.teamSelect({ id: 'pr-with', value: 'Dynasty Dads' }),
  colsOverride: '<p style="margin: 0; font-size: 15px; color: {{t.dim}}">Roster columns and the analysis as in the dialog above, unchanged.</p>',
  sendNames: names(k.P_SEND), receiveNames: names(k.P_RECV), send: true, canSend: true,
  alert: k.alertBar('transactions are locked by the commissioner') }));

const f = k.fmt1, P = k.P_RES, C = k.C_RES;
const notes = k.notes([
  "The one filled action on these boards is 'Send Offer' (Accent fill), and it is filled because the dialog is modal (6px double Frame on a Field scrim; the page behind has none). 'Cancel' is a ghost. Send Offer is disabled (solid Rule edge, Dim text, no opacity, no dash) until both sides have a player. The title is 'Propose Trade' or 'Counter Trade', one pixel h2; the product's 'Trade with' select is the kit select (44px, disabled with a solid Rule edge when countering).",
  "Roster columns keep the product's data and order: players in QB, RB, WR, TE, K, DEF order, one checkbox row each; the accessible name stays the product's label, '{name} ({position}) · weekly proj {n} · ROS {n}'. Product change: the visible label is split into a position tag, the name and two right-aligned tabular figures under 'Weekly proj' and 'ROS' column heads, so the position captions between groups become the tag on every row and a rule between groups; rows are 44px. A checked row fills its square with Ink and bolds the name (no Play-blue: position tags keep their contrast pairs on Panel). Under both columns the analysis runs on its own 600ms after the selection changes (the dialog's autoRun): 'Analyzing…' (Dim) and then the result; the 'You send (n):' and 'You receive (n):' chip rows follow.",
  "Analysis numbers (desktop and phone), one decimal as formatPoints prints them (product change, the wire sends two): Darkness Falls sends Jordan Addison " + f(112) + " (becomes " + f(P.rows[0].fit) + " on Dynasty Dads, WR is full there: 4 WR for 3 slots, factor 0.85) and Rome Odunze " + f(60) + " (" + f(P.rows[1].fit) + "), and receives Malik Nabers " + f(166) + " (" + f(P.rows[2].fit) + " on Darkness Falls, 0.85). Proposer gives " + f(P.proposerGives) + " and gets " + f(P.proposerGets) + ", receiver gives " + f(P.receiverGives) + " and gets " + f(P.receiverGets) + ": a gap of " + f(P.proposerGives - P.proposerGets) + " is under 10% of " + f(P.proposerGives) + ", so the verdict is Fair (outlined Ink chip). The Counter variant is the incoming Ghosts offer inverted and pre-filled (Spears and Kincaid out, Wilson in; the select disabled on Gridiron Ghosts), and now Darkness Falls is the proposer: gives " + f(C.proposerGives) + ", gets " + f(C.proposerGets) + " (Wilson " + f(150) + " becomes " + f(C.rows[2].fit) + " here), so it reads Favors Receiver, the same imbalance seen from the other side. The sender edits the checkboxes and sends; 'Counter offer sent' is the toast.",
  "Send Offer refused (product change): an error from the server (deadline, locked transactions, locked team, CPU team, nobody in one direction) shows as an alert inside the dialog, above the footer, with the dialog still open and Send Offer still enabled (the same press is the retry). Today the catch block (TradeCenter.jsx:388-391) puts the message on the page Alert and in an error toast, both behind the modal. The alert is a 2px Danger edge with the warning pictogram and role=alert, no second Retry. Roster-capacity and position-cap refusals arrive when a trade executes (accept or force approve), so they surface on the page, not in this dialog (TradesStates).",
  "Focus (spec): opening the dialog puts focus on the 'Trade with' select (on a Counter, where the select is disabled, on the first You send checkbox; on a deep link, on the first You send checkbox, since the team is preselected). Closing by Cancel, Escape or a successful send returns focus to the opener: the Propose Trade button, or the card's Counter button, which has left Pending after a send, so focus falls to the next card's heading (the Trades notes) and the toast announces. A deep link has no opener, so focus returns to the h1.",
  "Phone: the product has no breakpoint logic and the MUI dialog is fullWidth, so this is the same dialog edge to edge in one column, You send then You receive (the figure columns shrink to 56 and 48px), the header and footer pinned while the body scrolls (the board draws the body at full length). The right side of the phone row shows two more entries at desktop width: opened from the header (empty), and the deep link from the Players row. Position, weekly projection and ROS come from GET /api/league/:id/rosters; the analysis from POST /api/trades/analyze. Server refusals (deadline, roster capacity, CPU team) are on TradesStates. Data gap: none new.",
]);

const body = `<main style="max-width: 1236px; margin: 0 auto; padding: 40px 32px 64px; display: flex; flex-direction: column; gap: 48px; box-sizing: content-box">
<header style="display: flex; flex-direction: column; gap: 12px">${k.h1('Propose trade')}<p style="margin: 0; font-size: 17px; color: {{t.dim}}">${k.LG} · Darkness Falls · desktop dialog with analysis, phone full-screen dialog with the empty and deep-link entries, Counter variant</p></header>
${section('s-a', 'Desktop: Propose Trade', 'Trade with Dynasty Dads. Send Jordan Addison and Rome Odunze, receive Malik Nabers. Analysis: Fair. Send Offer is the one filled action (the dialog is modal).', desktop)}
${section('s-b', 'Phone: full-screen dialog, with the empty and deep-link entries', 'Same trade in one column at 390px; the other two entries are drawn at desktop width.', phoneRow)}
${section('s-c', 'Counter Trade', "Opened from 'Counter' on the Gridiron Ghosts card: the offer inverted and pre-filled, 'Trade with' disabled. The analysis now reads Favors Receiver (Darkness Falls is the proposer).", counter)}
${section('s-d', 'Send Offer refused', "The server refuses the send: the sentence shows inside the dialog, which stays open (a locked-transactions refusal as the example).", refused)}
${notes}
</main>`;
k.write(out, 'TradePropose.dc.html', k.page({ title: 'Trade propose and counter', w: 1300, h: 6575, body }));
console.log('ok');
