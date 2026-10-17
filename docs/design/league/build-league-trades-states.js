// Trade Center states sheet: Completed tab (five terminal statuses), analysis states, empties, Trade Block, loading, errors and server refusals, toasts.
const k = require('./league-kit-trades');
const out = process.argv[2];
const { SR, FRAME2, frameHead, h2s, btnGhost } = k;

const cap = (t, sub) => `<div style="display: flex; flex-direction: column; gap: 2px; margin-bottom: 12px"><span style="font-size: 14px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase">${t}</span>${sub ? `<span style="font-size: 13px; color: {{t.dim}}; max-width: 90ch; text-wrap: pretty">${sub}</span>` : ''}</div>`;
const section = (id, title, sub, inner) => `<section aria-labelledby="${id}" style="display: flex; flex-direction: column; min-width: 0"><div id="${id}">${cap(title, sub)}</div>${inner}</section>`;
const grid2 = (inner, al = 'start') => `<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; align-items: ${al}">${inner}</div>`;
const M = (name, pos, nfl) => ({ name, pos, nfl });
const V = k.VIEWER;

// A. Completed tab: every non-pending, non-accepted status. No actions: only pending and accepted trades carry buttons (the commissioner's too).
const completed = [
  k.tradeCard({ id: 'trade-10', a: 'Gridiron Ghosts', b: 'Blitz Brigade', age: 'Fri 6:45 PM', status: 'Executed', leftLabel: 'Gridiron Ghosts Receives', left: [k.SUTTON], rightLabel: 'Blitz Brigade Receives', right: [k.BROWN] }),
  k.tradeCard({ id: 'trade-8', a: 'Hail Mary Club', b: V, you: V, age: 'Thu 4:20 PM', status: 'Rejected', leftLabel: 'You Receive', left: [M('Jakobi Meyers', 'WR', 'LV')], rightLabel: 'Hail Mary Club Receives', right: [k.df('Chris Olave')] }),
  k.tradeCard({ id: 'trade-7', a: 'Waiver Wolves', b: 'Bench Mob', age: 'Wed 7:45 PM', status: 'Vetoed', leftLabel: 'Waiver Wolves Receives', left: [M('Rashee Rice', 'WR', 'KC')], rightLabel: 'Bench Mob Receives', right: [M('Josh Jacobs', 'RB', 'GB')] }),
  k.tradeCard({ id: 'trade-6', a: V, b: 'Red Zone Rejects', you: V, age: 'Tue 11:05 AM', status: 'Cancelled', leftLabel: 'You Receive', left: [M('Zach Charbonnet', 'RB', 'SEA')], rightLabel: 'Red Zone Rejects Receives', right: [k.df('Rome Odunze')] }),
  k.tradeCard({ id: 'trade-5', a: 'Pocket Aces', b: V, you: V, age: 'Mon 2:30 PM', status: 'Countered', leftLabel: 'You Receive', left: [M('Chuba Hubbard', 'RB', 'CAR')], rightLabel: 'Pocket Aces Receives', right: [k.df('Jordan Addison')] }),
];
const completedTab = `<div style="display: flex; flex-direction: column; gap: 16px">${k.trTabs({ selected: 1 })}${grid2(completed.slice(0, 4).join(''))}<div style="max-width: calc(50% - 10px)">${completed[4]}</div></div>`;

// B. Analysis states, one tertiary frame each
// Each specimen is a sheet caption (Archivo, with its dim line) over a tertiary frame, so the verdict chip is the only pixel word.
const frame = (id, title, sub, inner) => `<section aria-labelledby="${id}" style="min-width: 0"><div id="${id}">${cap(title, sub)}</div><div style="${FRAME2}; padding: 16px 20px; display: flex; flex-direction: column; gap: 12px">${inner}</div></section>`;
const COLL = k.analyze([k.df('Tank Bigsby')], [k.dads('Malik Nabers')], k.posOf(k.DF), k.posOf(k.DADS));
if (COLL.verdict !== 'collusion_risk') throw new Error('collusion specimen reads ' + COLL.verdict);
const analysis = `<div style="display: flex; flex-direction: column; gap: 20px">${grid2(`
${frame('an-1', 'Running', 'The button disables and reads Analyzing… while the request runs.', `<div>${k.btnOff('Analyzing…')}</div>`)}
${frame('an-2', 'Fair', 'The two fit-adjusted totals are within 10% of the larger.', k.analysisResult(k.P_RES))}
${frame('an-3', 'Favors Proposer', 'The proposer gets more value than the receiver.', k.analysisResult(k.A_RES))}
${frame('an-4', 'Favors Receiver', 'The receiver gets more value than the proposer.', k.analysisResult(k.C_RES))}
${frame('an-5', 'Collusion risk', 'The raw collusion_risk: the unadjusted values are over 50% apart.', k.analysisResult(COLL))}
${frame('an-6', 'Analysis failed', 'What an incoming or uninvolved card shows today.', `${k.alertBar('cannot analyze a trade with yourself')}<div>${btnGhost('Analyze Trade')}</div>`)}`)}</div>`;

// C. Empty states (the three the page ships) and Trade Block
const empties = grid2(`
${k.emptyState({ id: 'em-1', title: 'No Pending Trades', text: 'Trades proposed by you or to you will appear here.' })}
${k.emptyState({ id: 'em-2', title: 'No Completed Trades', text: 'Executed, declined, and cancelled trades will show up here.' })}
${k.emptyState({ id: 'em-3', title: 'Not part of this league', text: "This is a pick'em league. Drafts, rosters, and matchups are not part of it.", tail: btnGhost("Back to Sunday Pick'em") })}
${k.emptyState({ id: 'em-4', title: 'Trade Block', text: 'Mark players as available so the rest of the league can make an offer. Coming soon.' })}`);

// D. Loading: the page skeleton (title, button, three card blocks), no copy
const loading = `<div aria-busy="true" data-testid="page-skeleton" style="display: flex; flex-direction: column; gap: 16px; max-width: 760px"><div style="display: flex; justify-content: space-between; align-items: center">${k.skel('200px', 48)}${k.skel('140px', 44)}</div>${[0, 1, 2].map(() => `<div style="${FRAME2}; padding: 20px; display: flex; flex-direction: column; gap: 12px">${k.skel('60%', 20)}${k.skel('100%', 56)}${k.skel('40%', 20)}</div>`).join('')}</div>`;

// E. The page error alert and the three server refusals; the refusal also arrives as an error toast
const errors = `<div style="display: flex; flex-direction: column; gap: 20px; max-width: none">
<div>${cap('Page error (non-fatal)', 'Above the tab content; the page renders below it with the Pending empty state.')}${k.alertBar('We could not load trades.', { retry: true })}</div>
<div>${cap('Server refusals', "The server's sentence, verbatim, in the same alert (2px Danger edge, warning pictogram) and in an error toast. The capacity and position-cap refusals arrive when a trade executes (accept or force approve); Darkness Falls holds 15 players, a full roster, so a swap that leaves it with 16 is refused. A refused send inside the Propose dialog is on the TradePropose sheet.")}<div style="display: flex; flex-direction: column; gap: 12px">${['the trade deadline (week 10) has passed', 'trade would put Darkness Falls over its roster capacity of 15', "that team is managed by the CPU and doesn't trade"].map(t => `<div style="display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px 20px"><div style="min-width: 0">${k.alertBar(t)}</div>${k.toast(t, { error: true })}</div>`).join('')}</div></div>
</div>`;

// F. Toasts
const toasts = `<div style="display: flex; flex-wrap: wrap; gap: 12px">${['Trade offer sent', 'Counter offer sent', 'Trade accepted', 'Trade rejected', 'Trade cancelled', 'Veto vote recorded', 'Trade approved', 'Trade vetoed'].map(t => k.toast(t)).join('')}</div>`;

const f = k.fmt1, N = k.analyze([k.df('Tank Bigsby')], [k.dads('Malik Nabers')], k.posOf(k.DF), k.posOf(k.DADS));
const notes = k.notes([
  "Completed tab = every trade that is not pending or accepted, in the API's order. Each card is the Pending card without the viewer's or commissioner's buttons (only pending and accepted trades carry them) and keeps the footer row with 'Analyze Trade'. The status chip is Pixel 16: EXECUTED (the feed's Ghosts and Blitz Brigade trade, Courtland Sutton for Chase Brown; the age is created_at, Fri 6:45 PM, well before the Sun 4:00 AM execution the dashboard feed shows as 5h ago), REJECTED (the viewer declined), VETOED, CANCELLED (the viewer withdrew it), COUNTERED (the viewer answered it with a counter). Ages follow formatTimeSince: weekday and time between 24 hours and 7 days. A countered card is the original offer; the counter itself is its own trade (a new card from the viewer's team, here already settled and not drawn). No 'expired' status exists. Columns read as the product labels them for an involved viewer; for an uninvolved one they are drawn correctly (see the Trades notes for the product bug).",
  "Analysis states: 'Analyze Trade' disables and reads 'Analyzing…' while the request runs; the verdicts are outlined Ink chips (Fair, Favors Proposer, Favors Receiver, and the raw collusion_risk drawn as 'Collusion risk', product fix; a raw margin over 50% blocks it: Tank Bigsby " + f(68) + " for Malik Nabers " + f(166) + " is " + Math.round((166 - 68) / 166 * 100) + "% apart). Figures print to one decimal (formatPoints, product change). The failure drawn is the real one today: 'cannot analyze a trade with yourself' appears when a receiver analyzes an incoming offer (decision.service.js:1045), because the route always makes the viewer the proposer (trades.router.js:77-90); the spec lets the route analyze the trade as its own proposing and receiving teams. Every number comes from the analysis function: the fit factor is 1.15 when the receiving roster has no player at the position, 0.85 when its slots at that position are full, otherwise 1.0; the verdict compares the two fit-adjusted totals and is Fair within 10% of the larger.",
  "Empties: 'No Pending Trades' and 'No Completed Trades' keep the product's two sentences in a tertiary frame (the handshake and history icons are dropped: no pixel art without meaning); 'Not part of this league' is the pick'em-only league's whole page (sentence plus a ghost 'Back to {league}'); the Trade Block tab is the static 'Coming soon' copy. Loading is the page skeleton, no copy (aria-busy). Errors: the non-fatal page Alert above the tab content, a 2px Danger edge with the house copy 'We could not load trades.' and one Retry inside the alert (the product shows the server's message and no Retry; product change), then the three server refusals the inventory lists, verbatim and in lower case as the server sends them (sentence case is a spec decision), each also as an error toast. The roster-capacity sentence names Darkness Falls and 15, which is its real roster size (15 players, a full roster). Toasts are the product's strings in a 2px Ink bar with a pixel check; the error toast uses the Danger edge and the warning pictogram. Red appears only on errors.",
]);

const body = `<main style="max-width: 1236px; margin: 0 auto; padding: 40px 32px 64px; display: flex; flex-direction: column; gap: 48px; box-sizing: content-box">
<header style="display: flex; flex-direction: column; gap: 12px">${k.h1('Trades states')}<p style="margin: 0; font-size: 17px; color: {{t.dim}}">${k.LG} · Completed tab, analysis, empties, Trade Block, loading, errors and refusals, toasts</p></header>
${section('s-a', 'Completed tab', 'Executed, rejected, vetoed, cancelled and countered: no buttons on any of them.', completedTab)}
${section('s-b', 'Analysis', 'Running, the four verdicts, and the failure the card shows today for an incoming or uninvolved trade (cannot analyze a trade with yourself); the spec fixes the route.', analysis)}
${section('s-c', 'Empty states and Trade Block', 'Pending, Completed, the pick\'em-only league, and the Trade Block tab.', empties)}
${section('s-d', 'Loading', 'Page skeleton: title, button, three card blocks.', loading)}
${section('s-e', 'Errors and server refusals', 'The non-fatal page error and three refusals, as alert and as toast.', errors)}
${section('s-f', 'Toasts', 'The product\'s eight confirmations.', toasts)}
${notes}
</main>`;
k.write(out, 'TradesStates.dc.html', k.page({ title: 'Trades states', w: 1300, h: 4525, body }));
console.log('ok');
