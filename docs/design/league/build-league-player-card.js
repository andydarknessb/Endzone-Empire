// Player card sheet (wave 3): the desktop drawer (lineup-managed, Puka Nacua, Out), the phone bottom sheet in the waivers context with the claim bar,
// the rostered action row, and the loading and error specimens. Thursday Night Regulars, Week 7, Sunday 9:10 AM CDT.
const k = require('./league-kit-card');
const out = process.argv[2];
const LG = 'Thursday Night Regulars';
const { px, h1, FRAME2, frameHead, skel } = k;

const cap = (t, sub) => `<div style="display: flex; flex-direction: column; gap: 2px; margin-bottom: 12px"><span style="font-size: 14px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase">${t}</span>${sub ? `<span style="font-size: 13px; color: {{t.dim}}; text-wrap: pretty">${sub}</span>` : ''}</div>`;
const section = (id, title, sub, inner) => `<section aria-labelledby="${id}" style="display: flex; flex-direction: column; min-width: 0"><div id="${id}">${cap(title, sub)}</div>${inner}</section>`;

// ---- A. desktop drawer: lineup-managed my_team ----
const P = k.PUKA, G = P.game;
const LD = require('./lineup-data');
const puka = LD.STARTERS.find(s => s.name === 'Puka Nacua');
const benchWR = LD.BENCH.filter(b => b.pos === 'WR').sort((a, b) => b.proj - a.proj);
if (puka.proj !== '0.0' || puka.inj !== 'Out') throw new Error('Puka fixture drifted from lineup-data.js');
const desk = k.drawer({
  label: P.name,
  header: k.cardHeader({ id: 'dc-t', name: P.name, pos: P.pos, inj: P.inj, team: P.team }),
  actions: k.lineupActions({ starting: true }),
  sections: [
    k.injurySection({ id: 'd-inj', view: 'Out', detail: 'Ruled out for Week 7.', practice: 'DNP (Wed), DNP (Thu), DNP (Fri)' }),
    k.gameSection({ id: 'd-game', opp: G.away, kickoff: G.kickoff, line: { spread: G.line.fav === P.team ? -G.line.spread : G.line.spread, total: G.line.total }, weather: G.venue.indoor ? 'Indoor' : G.weather }),
    k.projectionSection({ id: 'd-proj', floor: 0, proj: Number(puka.proj), ceil: 0 }),
    k.usageSection({ id: 'd-use' }),
    k.pukaStrip('d-strip-h'),
    k.seasonSection({ id: 'd-seas' }),
    `<div>${k.seasonPick([2026, 2025, 2024], 2026)}</div>`,
    k.weeklySection({ id: 'd-wk' }),
    k.gameLogSection({ id: 'd-log' }),
    k.benchSection({ id: 'd-bench', options: benchWR.map(b => ({ pos: b.pos, name: b.name, proj: b.proj })) }),
  ],
});
const deskA = section('s-a', 'Desktop drawer · lineup-managed (my_team)', `Puka Nacua, Out, opened from his Lineup row · Sunday 9:10 AM CDT · Week 7. Right-anchored, 560 wide, scrolls inside itself. Section order is the product's; News is not drawn for your own player.`, desk);

// ---- B. phone bottom sheet: waivers context (Michael Wilson, the cursor row of the Waivers boards; every figure is read from league-kit-waivers.js) ----
const WV = require('./league-kit-waivers');
const WP = WV.CURSOR, WIDX = WV.POOL.indexOf(WP) + 1;
const WG = require('./week7-games').gameOf(WP.team), WOPP = WG.away === WP.team ? WG.home : WG.away;
const NEWS = [
  { headline: 'Wilson logged a full practice on Friday.', date: '10/16/2026' },
  { headline: 'Arizona lists Wilson as its No. 2 receiver on the Week 7 depth chart.', date: '10/16/2026' },
];
// Roster is at capacity (15 of 15), so the drop is required; the server's suggested drop arrives preselected: Tyler Allgeier, the lowest Rest of season player not on IR (dropSuggestionFor), as on the Waivers sheets.
const claim = k.claimBar({ name: WP.name, drop: 'Tyler Allgeier (RB)', bid: '9', remaining: WV.FAAB.left, priority: 5, filled: true, capacity: true, drops: WV.DROPS, id: 'ph-cl' });
const upPill = t => `<span style="display: inline-flex; padding: 0 8px; border: 2px solid {{t.ink}}; font-weight: 700">${t}</span>`;
const phoneSheet = k.phoneSheet({
  label: WP.name,
  header: k.cardHeader({ id: 'ph-t', name: WP.name, pos: WP.pos, team: WP.team, nav: { n: WIDX, total: Math.min(WV.PAGE, WV.POOL.length) }, phone: true }),
  actions: `${claim}<div style="padding: 0 16px 16px">${k.watchBtn(false)}</div>`,
  sections: [
    k.newsSection({ id: 'ph-news', items: NEWS }),
    k.injurySection({ id: 'ph-inj', view: null, practice: 'Full (Fri)' }),
    k.usageSection({ id: 'ph-use', table: false, opps: `Opp rank vs WR: W7 ${WOPP} 12th` }),
    k.stripSection({ id: 'ph-strip', tiles: [k.tile('Week 7 projection', WV.f1(WP.proj)), k.tile('Rest of season (thru Wk 18)', WV.f1(WP.ros)), k.tile('Ownership', WP.own + '.0%'), k.tile('Depth chart', 'WR2'), k.tile('Upgrade', WV.upPill(WP))] }),
  ],
  behind: `${skel('150px', 16)}${skel('230px', 24)}${skel('100%', 44)}${skel('100%', 44)}`,
});
const phoneNotes = ['The sheet is modal, so Claim is filled (the one filled action on screen). The page behind carries its own cursor row (Michael Wilson, the largest Upgrade not yet claimed); the sheet hides it.', 'At 390 the counter, previous, next and close sit on their own row above the name so the name keeps the width. The counter follows the Waivers list order.', 'The claim bar sits under the header and before News. It scrolls with the sheet, so the sections below keep their order.', 'The roster is full (15 of 15), so a drop is required and Claim stays disabled until one is chosen; the bid must be a whole number from $0 to $62. Priority #5 breaks equal bids.', 'Below the fold: Injury (practice line), Usage (the Opp rank line only; the table is lineup-managed), Decision strip with the Upgrade pill (outlined Ink, not green; Wilson reads +2.4 Wk 9 because ARI is on bye in Week 8), Season summary, season pick, weekly points, game log.'];
const phoneBlock = section('s-b', 'Phone bottom sheet · waivers context', `${WP.name}, a player on waivers, opened from the Waivers list at 390 wide. 88% of the screen tall; the first screen shows the claim bar in full.`, `<div style="display: grid; grid-template-columns: 390px minmax(0, 1fr); gap: 20px; align-items: start">${phoneSheet}<ul style="list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; font-size: 13px; color: {{t.dim}}">${phoneNotes.map(n => `<li style="padding-bottom: 12px; border-bottom: 2px solid {{t.rule}}; text-wrap: pretty">${n}</li>`).join('')}</ul></div>`);

// ---- C. rostered: the action row ----
const rost = k.drawer({
  label: 'Patrick Mahomes',
  header: k.cardHeader({ id: 'ro-t', name: 'Patrick Mahomes', pos: 'QB', team: 'KC' }),
  actions: k.rosteredActions('Sunday Scaries'),
});
const rosterBlock = section('s-c', 'Rostered context · action row', "A player on another team. \"Propose trade\" is a ghost link to Trade Center; \"Rostered by {team}\" beside it. The Watch toggle is drawn pressed here: Watching is the Play-blue selected state, never the filled green action. News follows below the row.", rost);

// ---- D. loading and error (opened with only an id and a name, the Activity feed's case) ----
const loading = k.drawer({ label: 'Jaylen Warren', busy: true, header: k.cardHeader({ id: 'lo-t', name: 'Jaylen Warren' }), actions: k.loadingBody() });
const failed = k.drawer({ label: 'Jaylen Warren', header: k.cardHeader({ id: 'er-t', name: 'Jaylen Warren' }), actions: k.alertBox("We could not load this player's details.") });
const stateBlock = section('s-d', 'Loading and error · opened from the Activity feed', 'The caller knows only the id and the name, so the header paints the name alone and the actions wait on the card read (aria-busy, "Loading player details" for screen readers). Error: no action bar renders.', `<div style="display: flex; flex-direction: column; gap: 24px">${cap('Loading', 'Skeleton blocks where the actions and sections will land; no animation.')}${loading}${cap('Error', 'Danger edge and alert pictogram; the house form "We could not load ..." (a product change).')}${failed}</div>`);

const notes = k.notes([
  "Look option: one markup for all eight callers, as a look=\"playselect\" option on PlayerDecisionCard (the spec decides whether wave 3 passes it from Lineup, Waivers and Trades only). Drawer = primary frame (6px double Frame); every section is a tertiary frame with a Pixel 16 h3; the player's name is Archivo 24 700 (a name is not pixel type) as the h2; tables are k.table at 8px cell padding; chips are in-row badges (Archivo 13 700 uppercase). Out is the inverted Ink tag, never red.",
  "Filled-action rule: the desktop drawer carries no filled control (Bench, Compare, Trade, Drop, Watch, Swap, Claim, Add and Propose trade are all ghost). The phone sheet is modal, so its Claim is the one filled action on screen. Watching (pressed) is the Play-blue selected state. Drop stays Ink, not Danger: the confirm dialog that follows carries the destructive treatment.",
  "Data gaps: Bio is not drawn, because the card ships bio: null today and there is nothing to show. \"No practice this week\" is not drawn on Puka: the product sets it only for Questionable players. Loading skeletons are new: the product has only the hidden status text. Usage season averages are rounded to one decimal here. Error copy takes the house form \"We could not load this player's details.\", a product change from the product's \"Couldn't load this player's details.\"",
]);

const body = `<main style="max-width: 1236px; margin: 0 auto; padding: 40px 32px 64px; display: flex; flex-direction: column; gap: 48px; box-sizing: content-box">
<header style="display: flex; flex-direction: column; gap: 12px">${h1('Player card')}<p style="margin: 0; font-size: 17px; color: {{t.dim}}">${LG} · Sunday 9:10 AM CDT · drawer, phone sheet, action rows, loading and error</p></header>
<div style="display: grid; grid-template-columns: 560px minmax(0, 1fr); gap: 32px; align-items: start">
${deskA}
<div style="display: flex; flex-direction: column; gap: 40px; min-width: 0">${phoneBlock}${rosterBlock}${stateBlock}${notes}</div>
</div>
</main>`;
k.write(out, 'PlayerCard.dc.html', k.page({ title: 'Player card', w: 1300, h: 3200, body }));
console.log('ok');
