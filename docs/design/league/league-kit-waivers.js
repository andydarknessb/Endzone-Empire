// Wave 3 Waivers pieces and the Week 7 waiver fixture. Own file so parallel builders never collide.
// Product truth: src/pages/waivers, widgets player-pool, player-row, waiver-summary, waiver-claims, bye-cluster, features claim-player (E:/ee-ps-w3-read).
const k = require('./league-kit-samples');
const { px, SR, esc, FRAME, FRAME2, h2s, frameHead, arrow, warn, clock, lockIcon, posTag } = k;
// Injury as the product's code (Q, D, O, IR) with the status as screen-reader text; Out is the filled Ink chip.
const INJ = { Questionable: 'Q', Doubtful: 'D', Out: 'O', 'Injured reserve': 'IR' };
const injTag = word => `<span style="display: inline-flex; align-items: center; box-sizing: border-box; height: 22px; padding: 0 6px; border: 2px solid currentColor; ${word === 'Out' ? 'background: {{t.ink}}; color: {{t.bg}}; border-color: {{t.ink}}; ' : ''}font-size: 13px; font-weight: 700; letter-spacing: .04em; line-height: 1; flex: none"><span aria-hidden="true">${INJ[word] || word}</span><span style="${SR}">Injury status: ${word}</span></span>`;
const D = require('./lineup-data');
const W7 = require('./week7-games');

// ---- fixture clock: Sunday Oct 18, 9:10 AM CDT. Minutes since Friday 00:00 ----
const DAYS = ['Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu'];
const parse = s => { const m = /^(\w{3}) (\d+):(\d+) ([AP])M$/.exec(s); return DAYS.indexOf(m[1]) * 1440 + ((+m[2] % 12) + (m[4] === 'P' ? 12 : 0)) * 60 + +m[3]; };
const show = abs => { const d = Math.floor(abs / 1440), mm = abs % 1440, h = Math.floor(mm / 60), m = mm % 60; return `${DAYS[d % 7]} ${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };
const NOW = parse('Sun 9:10 AM');
// timeUntil's house style (shared/lib/timeUntil.js:56-70): top two units, second padded, no leading zero unit.
const until = rem => rem >= 1440 ? `${Math.floor(rem / 1440)}d ${String(Math.floor(rem / 60) % 24).padStart(2, '0')}h` : rem >= 60 ? `${Math.floor(rem / 60)}h ${String(rem % 60).padStart(2, '0')}m` : `${rem}m`;
// League rules are the Commissioner board's: 48-hour waiver period (the bye line says so). This league clears every claim together at the weekly clear, Wed 2:00 AM (the product's blanket branch).
const PERIOD_H = 48;
const WEEKLY_CLEAR = parse('Wed 2:00 AM');

// ---- the pool: players dropped since the last weekly clear (unrostered); they all clear together. proj = Proj Wk 7 ----
// weekly values: proj x a fixed wave, null on the team's bye (BYE in lineup-data.js, three teams local); ROS is their sum.
const WAVE = [1, .94, 1.07, .99, 1.05, .91, 1.1, .97, 1.03, .93, 1.08, 1];
const LOCAL_BYE = { SEA: 10, MIA: 12, PHI: 9 };
const byeOf = t => D.BYE[t] ?? LOCAL_BYE[t];
const r1 = n => Math.round(n * 10) / 10;
const f1 = n => n.toFixed(1);
// Upgrade model (ADR 0055 point 1, ADR 0062): the gain to the OPTIMAL lineup (starters and bench), read in the player's first playable week after his Clear time
// (playerCard.service.js:313-326). Claims clear Wed 2:00 AM, after Monday night, so that is Week 8, or Week 9 when his team is on bye in Week 8.
// Darkness Falls' healthy base projections (lineup-data.js; Puka Nacua is Out in Week 7 only, so his base is a fixture assumption; Chris Olave's Week 7 bye hides his 11.6).
const BASE = { 'Josh Allen': 22.1, 'Jahmyr Gibbs': 19.6, 'Woody Marks': 11.8, 'Puka Nacua': 16.2, "Ja'Marr Chase": 16.9, 'Trey McBride': 8.9, 'Brandon Aubrey': 8.1, Broncos: 6.4, 'Tyjae Spears': 12.9, 'Jordan Addison': 10.1, 'Dalton Kincaid': 7.4, 'Tank Bigsby': 6.2, 'Tyler Allgeier': 5.8, 'Chris Olave': 11.6 };
const MINE = [...D.STARTERS.filter(s => !s.empty), ...D.BENCH].map(s => { const [pos, team] = s.sub.split(' · '); return { name: s.name, pos, team, base: BASE[s.name] }; });
const projIn = (p, w) => byeOf(p.team) === w ? null : r1(p.base * WAVE[w - 7]);
// Best legal lineup: QB, RB x2, WR x2, TE, FLEX (RB, WR or TE), K, DEF. Players on bye in the week cannot play.
function optimal(players, w) {
  const live = players.map(p => ({ ...p, pts: projIn(p, w) })).filter(p => p.pts != null);
  const top = (pos, n) => live.filter(p => p.pos === pos).sort((a, b) => b.pts - a.pts).slice(0, n);
  const start = [...top('QB', 1), ...top('RB', 2), ...top('WR', 2), ...top('TE', 1), ...top('K', 1), ...top('DEF', 1)];
  const flex = live.filter(p => ['RB', 'WR', 'TE'].includes(p.pos) && !start.includes(p)).sort((a, b) => b.pts - a.pts)[0];
  const lineup = flex ? [...start, flex] : start;
  return { total: lineup.reduce((a, p) => a + p.pts, 0), names: new Set(lineup.map(p => p.name)), byName: Object.fromEntries(lineup.map(p => [p.name, p.pts])) };
}
const RAW = [
  // name, pos, team, injury, proj, ownership %, claim rank
  ['Rashid Shaheed', 'WR', 'SEA', '', 14.6, 38, 1],
  ['Michael Wilson', 'WR', 'ARI', '', 13.8, 29],
  ['Jaylen Wright', 'RB', 'MIA', 'Questionable', 12.4, 17],
  ['Kimani Vidal', 'RB', 'LAC', '', 12.0, 22],
  ['Jalen McMillan', 'WR', 'TB', '', 11.6, 14, 2],
  ['Dalton Schultz', 'TE', 'HOU', '', 9.8, 41],
  ['Ty Chandler', 'RB', 'MIN', '', 8.4, 9],
  ['Seahawks', 'DEF', 'SEA', '', 8.2, 12],
  ['Cairo Santos', 'K', 'CHI', '', 8.8, 18],
  ['Gardner Minshew', 'QB', 'LV', '', 14.6, 6],
];
const POOL = RAW.map(([name, pos, team, inj, proj, own, claim]) => {
  const g = W7.gameOf(team), opp = g ? (g.away === team ? g.home : g.away) : null, bye = byeOf(team);
  const onBye7 = !g;
  const weeks = WAVE.map((f, i) => (i + 7 === bye || (i === 0 && onBye7)) ? null : r1(proj * f));
  const played = weeks.filter(v => v != null), ros = r1(played.reduce((a, b) => a + b, 0));
  const upWk = bye === 8 ? 9 : 8, wkPts = weeks[upWk - 7];
  const cand = { name, pos, team, base: wkPts / WAVE[upWk - 7] };
  const before = optimal(MINE, upWk), after = optimal([...MINE, cand], upWk);
  const up = r1(after.total - before.total);
  const out = [...before.names].find(n => !after.names.has(n)); // the starter the claim moves out of the lineup
  const rem = WEEKLY_CLEAR - NOW;
  return { name, pos, team, inj, opp, bye: onBye7 ? 7 : bye, onBye7, proj, own, claim: claim || null, upWk, wkPts, weeks, ros, per: r1(ros / played.length), over: out || null, overPts: out ? before.byName[out] : null, up: up > 0 ? up : 0, rem, clearAt: WEEKLY_CLEAR, clearsText: until(rem), clearsAbs: show(WEEKLY_CLEAR) };
});
// The cursor: among the rows on the page, the unclaimed row with the largest positive Upgrade whatever week it reads in; ties by that week's projection, then name.
// Rows with a pending claim are skipped. No positive Upgrade (or best ball, which has none): no cursor and no filled action. The frame turns Danger when the row clears in under an hour.
const cursorOf = pool => pool.filter(p => !p.claim && p.up > 0).sort((a, b) => b.up - a.up || b.wkPts - a.wkPts || a.name.localeCompare(b.name))[0] || null;
const CURSOR = cursorOf(POOL);
POOL.sort((a, b) => b.up - a.up || b.wkPts - a.wkPts || a.name.localeCompare(b.name)); // the Upgrade sort, highest first
const TOTAL = 14, PAGE = 10;

// ---- roster, claims, results ----
const ROSTER_COUNT = D.STARTERS.filter(s => !s.empty).length + D.BENCH.length + D.IR.length; // 8 + 6 + 1
const CAPACITY = 15; // a plain roster limit (9 starting slots + 6 bench); the server sends rosterCapacity, rosterCount >= capacity is Full (shared/lib/rosterCapacity.js:8-12)
if (ROSTER_COUNT !== 15) throw new Error('roster count ' + ROSTER_COUNT);
const FAAB = { left: 62, committed: 19, pending: 2 };
const CLAIMS = [
  { rank: 1, name: 'Rashid Shaheed', drop: 'Tyler Allgeier', bid: 14 },
  { rank: 2, name: 'Jalen McMillan', drop: 'Tyler Allgeier', bid: 5 },
];
// FAAB check: $100 budget, $12 (Woody Marks) + $7 earlier spent = $19, $19 held by the two pending bids, $62 left.
const RESULTS = [
  { week: 'Week 6', rows: [['Woody Marks', 'Won · $12'], ['Elijah Moore', 'Lost to Waiver Wolves · won at $17 · your bid $9']] },
  { week: 'Earlier', rows: [['Jalen Nailor', 'Won · $7']] },
];
// Roster for the drop list: every rostered player, lowest Proj Wk first. Allgeier and Bigsby are bench RBs.
const DROPS = [...D.STARTERS.filter(s => !s.empty), ...D.BENCH, ...D.IR].map(s => ({ name: s.name, pos: s.sub.split(' · ')[0], proj: s.proj })).sort((a, b) => a.proj - b.proj || a.name.localeCompare(b.name));
// Bye clusters (bye-cluster/lib/computeByeClusters): weeks 8 to 14, rostered players with IR excluded, from lineup-data.js STARTERS and BENCH.
const ROSTERED = [...D.STARTERS.filter(s => !s.empty), ...D.BENCH].map(s => { const [pos, team] = s.sub.split(' · '); return { name: s.name, pos, team }; });
const CLUSTERS = Array.from({ length: 7 }, (_, i) => { const week = 8 + i, players = ROSTERED.filter(p => D.BYE[p.team] === week); return { week, count: players.length, players, sev: players.length >= 3 ? 'warning' : players.length === 2 ? 'notable' : 'quiet' }; });
const WORST = [...CLUSTERS].sort((a, b) => b.count - a.count || a.week - b.week)[0];
const joinNames = n => n.length <= 1 ? n[0] : n.length === 2 ? `${n[0]} and ${n[1]}` : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
const BYE_LINE = `Week ${WORST.week}: ${joinNames(WORST.players.map(p => p.name))} sit. Waivers clear ${show(WEEKLY_CLEAR)}.`; // product copy change: under a blanket clear the line names the clear, not the period (byeClusterCopy.js:24-36)

// ---- small pieces ----
const backLink = () => `<nav aria-label="Breadcrumb" style="margin-left: -10px">${k.link('League dashboard', 'League dashboard')}</nav>`;
const subline = n => `${n} players on waivers · FAAB league`;
const wvHead = ({ phone = false } = {}) => `<section aria-labelledby="h1" style="display: flex; flex-direction: column; gap: 4px; min-width: 0">${backLink()}<div style="display: flex; flex-direction: column; gap: 12px; min-width: 0">${k.h1('Waivers', { phone })}<p style="margin: 0; font-size: ${phone ? 16 : 17}px; color: {{t.dim}}">${subline(TOTAL)}</p></div></section>`;

const fullChip = () => `<span style="display: inline-flex; align-items: center; box-sizing: border-box; height: 28px; padding: 0 8px; border: 2px solid {{t.ink}}; font-size: 13px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; line-height: 1; flex: none">Full</span>`;
// Summary strip: a tertiary frame of four figures (Pixel 24 values, Archivo labels). Full is a word chip, not a colour.
function tile({ label, value, valueSr, note, chip, last = false, phone = false, first = false, twoLine = false }) {
  const bd = phone ? `${first || last ? '' : ''}` : '';
  return `<div role="group" aria-label="${esc(label)}" style="min-width: 0; box-sizing: border-box; padding: ${phone ? '12px 14px' : '16px 20px'}; display: flex; flex-direction: column; gap: 6px; ${bd}"><span style="font-size: 13px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: {{t.dim}}${twoLine ? '; min-height: 39px' : ''}">${label}</span><span style="display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px"><span style="${px(String(value).length > 11 ? 16 : 24)}; line-height: 1.3">${valueSr ? `<span aria-hidden="true">${value}</span><span style="${SR}">${valueSr}</span>` : value}</span>${chip || ''}</span><span style="font-size: ${phone ? 13 : 14}px; color: {{t.dim}}; text-wrap: pretty">${note}</span></div>`;
}
function summary({ tiles, phone = false }) {
  const n = tiles.length, cols = phone ? 2 : n;
  const cell = (t, i) => `<div style="min-width: 0; ${i % cols ? 'border-left: 2px solid {{t.rule}}; ' : ''}${i >= cols ? 'border-top: 2px solid {{t.rule}}' : ''}">${tile({ ...t, phone, twoLine: phone && tiles.slice(Math.floor(i / cols) * cols, Math.floor(i / cols) * cols + cols).some(x => x.label.length > 17) })}</div>`;
  return `<section aria-labelledby="ws-h" style="${FRAME2}; min-width: 0"><h2 id="ws-h" style="${SR}; margin: 0">Waiver summary</h2><div style="display: grid; grid-template-columns: repeat(${cols}, minmax(0, 1fr))">${tiles.map(cell).join('')}</div></section>`;
}
// Tile figures spell their units ("2 DAYS 16 H", "40 MIN"): Pixel 24 makes 2D 16H and 40M ambiguous.
const tileTime = rem => rem >= 1440 ? { value: `${Math.floor(rem / 1440)} DAYS ${Math.floor(rem / 60) % 24} H`, valueSr: `${Math.floor(rem / 1440)} days ${Math.floor(rem / 60) % 24} hours` } : rem >= 60 ? { value: `${Math.floor(rem / 60)} H ${rem % 60} MIN`, valueSr: `${Math.floor(rem / 60)} hours ${rem % 60} minutes` } : { value: `${rem} MIN`, valueSr: `${rem} minutes` };
const clearNote = `Waivers clear <span style="white-space: nowrap">${show(WEEKLY_CLEAR)}</span>`;
const NEXT = tileTime(WEEKLY_CLEAR - NOW), NEXT_NOTE = clearNote;
// A row at another clock (WaiversStates only): the same player with a different time left to the clear.
const atRem = (p, rem) => ({ ...p, rem, clearsText: until(rem) });
const TILES_FAAB = [
  { label: 'Next claim resolves', ...NEXT, note: NEXT_NOTE },
  { label: 'FAAB left', value: `$${FAAB.left}`, note: `$${FAAB.committed} bid on ${FAAB.pending} pending claims` },
  { label: 'Waiver priority', value: '#5', note: 'Breaks equal bids. A win sends you to the back.' },
  { label: 'Roster', value: `${ROSTER_COUNT}/${CAPACITY}`, chip: fullChip(), note: 'Every claim needs a drop.' },
];

// ---- controls ----
const sortDir = ({ phone = false } = {}) => `<button type="button" aria-label="Sort descending" style="width: 44px; height: 44px; padding: 0; display: grid; place-items: center; flex: none; box-sizing: border-box; border-radius: 0; background: transparent; border: 2px solid {{t.ink}}; color: {{t.ink}}"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" shape-rendering="crispEdges"><path d="M3 2h2v9h2v2H5v1H3zM9 2h2v2h2v2H9zM9 7h4v2H9zM9 12h4v2H9z" fill="currentColor" fill-rule="evenodd"/></svg></button>`;
const controls = () => `<div style="display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px 16px; padding: 16px 20px; border-bottom: 2px solid {{t.rule}}">
${k.field({ id: 'wv-q', label: 'Search players', placeholder: 'Search by name', w: 250 })}
${k.select({ id: 'wv-pos', label: 'Position', options: ['All', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'], value: 'All', w: 120 })}
${k.select({ id: 'wv-bye', label: 'Bye week', options: ['Any', ...Array.from({ length: 18 }, (_, i) => `Wk ${i + 1}`)], value: 'Any', w: 120 })}
${k.select({ id: 'wv-sort', label: 'Sort', options: ['Name', 'NFL Team', 'Bye week', 'ADP', 'Position rank', 'Pool projection', 'Upgrade'], value: 'Upgrade', w: 170 })}
${sortDir()}
${k.checkbox({ id: 'wv-watch', label: 'Watching' })}
</div>`;

// ---- row pieces ----
const nameBtn = n => `<button type="button" aria-label="${esc(n)}" style="min-height: 44px; display: inline-flex; align-items: center; padding: 0; margin: -10px 0; border: 0; border-radius: 0; background: none; color: inherit; font: inherit; font-size: 15px; font-weight: 600; text-align: left; cursor: pointer; white-space: nowrap">${n}</button>`;
const opp = p => p.opp ? `vs ${p.opp}` : `Bye ${p.bye}`;
const identity = p => `<div style="display: flex; align-items: center; gap: 8px; min-width: 0">${k.avatar(p.name, { size: 32 })}<div style="display: flex; flex-direction: column; gap: 2px; min-width: 0"><div style="display: flex; align-items: center; gap: 8px">${nameBtn(p.name)}${p.inj ? injTag(p.inj) : ''}</div><div style="display: flex; align-items: center; gap: 8px; font-size: 13px; color: {{t.dim}}">${posTag(p.pos)}<span>${p.team}</span><span>${opp(p)}</span></div></div></div>`;
// The Upgrade pill: an outlined Ink badge "+{pts}" (+ " Wk N" when the player's first playable week is not this one). Nothing when there is no gain.
const upPill = p => p.up > 0 ? `<span style="display: inline-flex; align-items: center; box-sizing: border-box; height: 24px; padding: 0 8px; border: 2px solid {{t.ink}}; font-size: 13px; font-weight: 700; line-height: 1; white-space: nowrap"><span aria-hidden="true">+${f1(p.up)}${p.upWk ? ` Wk ${p.upWk}` : ''}</span><span style="${SR}">Upgrade plus ${f1(p.up)}${p.upWk ? ` in week ${p.upWk}` : ' this week'}</span></span>` : '';
const projCell = p => p.onBye7 ? 'on bye' : f1(p.proj);
// Status: "On waivers" over "Clears in {t}" (Archivo), Danger text with the clock only when under an hour.
const status = p => { const soon = p.rem < 60; return `<div style="display: flex; flex-direction: column; gap: 1px"><span style="font-size: 14px; font-weight: 600">On waivers</span><span style="display: inline-flex; align-items: center; gap: 6px; font-size: 13px; ${soon ? 'color: {{t.danger}}; font-weight: 600' : 'color: {{t.dim}}'}">${soon ? clock('currentColor') : ''}Clears in ${p.clearsText}${soon ? '' : ''}</span></div>`; };
// Weeks 7 to 18: one labelled image, twelve bars, this week in Ink, a bye a flat 2px line.
const spark = (p, { w = 6 } = {}) => {
  const max = 18, h = 24, vals = p.weeks;
  const bars = vals.map((v, i) => { const bh = v == null ? 2 : Math.max(2, Math.round(v / max * h)); return `<rect x="${i * (w + 2)}" y="${h - bh}" width="${w}" height="${bh}" fill="${i === 0 ? 'var(--c-ink)' : 'var(--c-dim)'}"/>`; }).join('');
  const label = `Projected points by week, weeks 7 to 18: ${vals.map((v, i) => `week ${i + 7} ${v == null ? 'bye' : f1(v)}`).join(', ')}`;
  return `<svg role="img" aria-label="${esc(label)}" width="${vals.length * (w + 2) - 2}" height="${h}" viewBox="0 0 ${vals.length * (w + 2) - 2} ${h}" shape-rendering="crispEdges" style="display: block; --c-ink: {{t.ink}}; --c-dim: {{t.dim}}">${bars}</svg>`;
};
const chevron = open => `<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" shape-rendering="crispEdges"><path d="${open ? 'M5 3h2v2h2v2h2v2H9V7H7V5H5v2H3v2H1V7h2V5h2z' : 'M1 3h2v2h2v2h2V5h2V3h2v2H9v2H7v2H5V7H3V5H1z'}" fill="currentColor" fill-rule="evenodd"/></svg>`;
const expandBtn = (p, open, size = 44) => `<button type="button" aria-label="Show details for ${esc(p.name)}" aria-expanded="${open}" style="width: ${size}px; height: ${size}px; padding: 0; display: grid; place-items: center; flex: none; box-sizing: border-box; border-radius: 0; background: transparent; border: 2px solid transparent; color: {{t.ink}}">${chevron(open)}</button>`;
// One action per row: Claim (ghost), Claim #n on a pending row (ghost, helper as the description), and the one filled Claim on the cursor row only.
const claimBtn = (p, { fill = false, size = 44 } = {}) => {
  const label = p.claim ? `Claim #${p.claim}` : 'Claim';
  const b = k.smBtn(label, { fill, aria: `${label} ${p.name}` });
  const sized = b.replace('min-height: 36px', 'min-height: 44px').replace('padding: 0 14px', 'padding: 0 16px'); // house ghost padding 16px // 44px everywhere, the dense table included (tests/e2e/waivers.spec.ts asserts 44px at 1280)
  return p.claim ? sized.replace('<button ', `<button aria-describedby="pend-${p.claim}" `) + `<span id="pend-${p.claim}" style="${SR}">You already have a pending claim on this player.</span>` : sized;
};
const CUR = (first, last, c = '{{t.cursor}}') => `border-top: 4px solid ${c}; border-bottom: 4px solid ${c}; ${first ? `border-left: 4px solid ${c}; ` : ''}${last ? `border-right: 4px solid ${c}; ` : ''}`;

// ---- the list table (sticky Player column, tabular figures, 36px buttons allowed in the dense table) ----
const COLS = [['Player', 'left', 198], ['Proj Wk 7', 'right', 88], ['ROS', 'right', 58], ['Ownership', 'right', 96], ['Upgrade', 'right', 96], ['Weeks 7 to 18', 'left', 118], ['Status', 'left', 122], ['Action', 'right', 172]];
function wvTable({ rows, cursor, expanded, detail, bestBall = false }) {
  const cols = bestBall ? COLS.filter((_, i) => i !== 4) : COLS; // best ball has no Upgrade column
  const th = ([l, a, w], i) => `<th scope="col" style="${i === 0 ? 'position: sticky; left: 0; z-index: 1; ' : ''}box-sizing: border-box; width: ${w}px; height: 40px; padding: 0 8px; text-align: ${a}; background: {{t.panel}}; border-bottom: 2px solid {{t.rule}}; font-size: 13px; font-weight: 600; letter-spacing: .02em; text-transform: uppercase; color: {{t.dim}}; white-space: nowrap">${l}</th>`;
  const body = rows.map((p, ri) => {
    const cur = cursor && p.name === cursor.name, open = expanded === p.name, last = ri === rows.length - 1;
    const bd = open ? 'none' : (last ? 'none' : '2px solid {{t.rule}}');
    const all = [identity(p), projCell(p), f1(p.ros), `${p.own}%`, upPill(p), spark(p), status(p), `<div style="display: flex; align-items: center; justify-content: flex-end; gap: 4px">${expandBtn(p, open)}${claimBtn(p, { fill: cur })}</div>`];
    const cells = bestBall ? all.filter((_, i) => i !== 4) : all;
    const tds = cells.map((c, i) => {
      const al = cols[i][1];
      const st = `box-sizing: border-box; padding: 8px 8px; text-align: ${al}; background: {{t.panel}}; ${cur ? CUR(i === 0, i === cells.length - 1, p.rem < 60 ? '{{t.danger}}' : '{{t.cursor}}') : `border-bottom: ${bd}; `}font-size: 15px; vertical-align: middle; white-space: nowrap`;
      const cls = cur ? ' class="cursor"' : '';
      return i === 0 ? `<th scope="row"${cls} style="position: sticky; left: 0; z-index: 1; ${st}; font-weight: 600">${c}${cur ? `<span style="${SR}">Your next move: the largest Upgrade you have not claimed</span>` : ''}</th>` : `<td${cls} style="${st}">${c}</td>`;
    }).join('');
    const det = open ? `<tr><td colspan="${cols.length}" style="padding: 0; background: {{t.panel}}; border-bottom: ${last ? 'none' : '2px solid {{t.rule}}'}">${detail}</td></tr>` : '';
    return `<tr>${tds}</tr>${det}`;
  }).join('');
  return `<div role="region" aria-label="Players" tabindex="0" style="overflow-x: auto"><table style="width: 100%; border-collapse: separate; border-spacing: 0; min-width: 950px; table-layout: fixed"><caption style="${SR}">Players on waivers</caption><colgroup>${cols.map(c => `<col style="width: ${c[2]}px">`).join('')}</colgroup><thead><tr>${cols.map(th).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
}

// ---- expanded row (WaiverRowDetail) ----
const lab = t => `<span style="font-size: 13px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: {{t.dim}}">${t}</span>`;
// ClaimSheet.jsx:58-88: "Wk N swap" when the Upgrade's week is not the current one, both sides read in that week, the gain "+x Wk N"; no preview when nobody leaves the lineup.
function swapPreview(p) {
  if (!p.over) return '';
  return `<div data-testid="claim-sheet-swap" style="border: 2px solid {{t.rule}}; padding: 12px; display: flex; flex-direction: column; gap: 4px; min-width: 0"><span style="font-size: 13px; color: {{t.dim}}">Wk ${p.upWk} swap</span><span style="display: flex; justify-content: space-between; gap: 12px; font-size: 15px"><span>${p.name} ${f1(p.wkPts)}</span><span style="text-align: right">${p.over} ${f1(p.overPts)}</span></span><b style="font-size: 15px; font-weight: 700">+${f1(p.up)} Wk ${p.upWk}</b></div>`;
}
function rowDetail(p, news) {
  const newsList = `<ul style="margin: 4px 0 0; padding: 0 0 0 18px; font-size: 14px; display: flex; flex-direction: column; gap: 2px">${news.map(n => `<li>${n}</li>`).join('')}</ul>`;
  return `<div id="waiver-row-detail-${p.name.replace(/\W+/g, '-').toLowerCase()}" data-testid="waiver-row-detail" style="position: sticky; left: 0; box-sizing: border-box; width: 100%; max-width: 968px; padding: 16px 20px 20px; display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1.3fr) minmax(0, 1.2fr); gap: 20px; align-items: start; white-space: normal">
<div style="display: flex; flex-direction: column; gap: 12px">${swapPreview(p)}<div style="display: flex; flex-direction: column; gap: 2px">${lab('Rest of season')}<span style="font-size: 15px"><b style="font-weight: 700">${f1(p.ros)}</b><span style="color: {{t.dim}}"> · ${f1(p.per)} per game</span></span></div></div>
<div data-testid="waiver-row-detail-clear" style="display: flex; flex-direction: column; gap: 2px">${lab('Clear time')}<span style="font-size: 15px; text-wrap: pretty">Claims on ${p.name} resolve at ${p.clearsAbs} CDT (in ${p.clearsText}); the highest bid goes first.</span></div>
<div style="display: flex; flex-direction: column; gap: 12px"><div style="display: flex; flex-direction: column; gap: 2px">${lab('News')}<span role="status" style="font-size: 14px; color: {{t.dim}}">${news.length} news ${news.length === 1 ? 'item' : 'items'}</span>${newsList}</div><div>${k.btnGhost('Decision card', { aria: `Open ${p.name} Decision card` })}</div></div>
</div>`;
}

// ---- pager ----
const pagerBtn = (label, { on = false, off = false, aria, d } = {}) => `<button type="button"${aria ? ` aria-label="${aria}"` : ''}${on ? ' aria-current="page"' : ''}${off ? ' disabled' : ''} style="min-width: 44px; height: 44px; padding: 0 10px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; box-sizing: border-box; border-radius: 0; font-family: inherit; font-size: 15px; font-weight: 600; border: 2px solid ${on ? '{{t.play}}' : off ? '{{t.rule}}' : '{{t.ink}}'}; background: ${on ? '{{t.play}}' : 'transparent'}; color: ${on ? '{{t.playInk}}' : off ? '{{t.dim}}' : '{{t.ink}}'}; ${off ? 'cursor: not-allowed' : ''}">${on ? arrow() : ''}${d ? `<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="${d}" fill="currentColor"/></svg>` : label}</button>`;
const pager = ({ caption = `${TOTAL} players`, page = 1, pages = 2 } = {}) => `<nav aria-label="Pagination" style="display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 16px"><div style="display: flex; gap: 6px">${pagerBtn('', { off: page === 1, aria: 'Go to previous page', d: 'M7 1h2v10H7zM5 3h2v6H5zM3 5h2v2H3z' })}${Array.from({ length: pages }, (_, i) => pagerBtn(String(i + 1), { on: i + 1 === page, aria: `${i + 1 === page ? 'page' : 'Go to page'} ${i + 1}` })).join('')}${pagerBtn('', { off: page === pages, aria: 'Go to next page', d: 'M3 1h2v10H3zM5 3h2v6H5zM7 5h2v2H7z' })}</div><span style="font-size: 13px; color: {{t.dim}}">${caption}</span></nav>`;

// ---- My claims (tertiary frame) ----
const h3s = t => `<h3 style="margin: 0; font-size: 13px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase">${t}</h3>`;
const wvChip = t => `<span style="display: inline-flex; align-items: center; box-sizing: border-box; min-height: 32px; padding: 4px 10px; border: 2px solid {{t.ink}}; font-size: 14px; font-weight: 700; line-height: 1.25; white-space: nowrap">${t}</span>`;
const resultBlock = (r, reason) => { const m = /^(Lost) (to .*)$/.exec(r), head = m ? m[1] : r, detail = m ? m[2] : reason; return `<span data-testid="claim-result-line" style="display: flex; flex-direction: column; align-items: flex-start; gap: 4px">${wvChip(head)}${detail ? `<span style="font-size: 14px; color: {{t.dim}}; text-wrap: pretty">${detail}</span>` : ''}</span>`; };
const pencil = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" shape-rendering="crispEdges"><path d="M11 1h2v2h2v2h-2v-2h-2zM9 3h2v2h2v2h-2V5H9zM7 5h2v2h2v2H9V7H7zM5 7h2v2h2v2H7V9H5zM3 9h2v2h2v2H4v1H2v-1zM1 13h2v2H1z" fill="currentColor"/></svg>';
const mvBtn = (kind, aria, off = false) => k.iconBtn(kind, aria, { size: 44, off }).replace('dashed', 'solid'); // disabled is solid, never dashed
const editBtn = aria => `<button type="button" aria-label="${esc(aria)}" style="width: 44px; height: 44px; padding: 0; display: grid; place-items: center; flex: none; box-sizing: border-box; border-radius: 0; background: transparent; border: 2px solid {{t.ink}}; color: {{t.ink}}">${pencil}</button>`;
function pendingRow(c, i, n) {
  return `<li style="display: flex; flex-direction: column; gap: 4px; padding: 10px 0; ${i ? 'border-top: 2px solid {{t.rule}}' : ''}"><div style="display: flex; align-items: baseline; gap: 10px"><span style="font-size: 16px; font-weight: 700; min-width: 28px">#${c.rank}</span><div style="min-width: 0"><div style="font-size: 15px; font-weight: 600">${c.name}</div><div style="font-size: 14px; color: {{t.dim}}">Drop: ${c.drop || 'None'} · Bid $${c.bid}</div></div></div><div style="display: flex; flex-wrap: wrap; gap: 6px; margin-left: 38px">${mvBtn('up', `Move ${c.name} up`, i === 0)}${mvBtn('down', `Move ${c.name} down`, i === n - 1)}${editBtn(`Edit claim on ${c.name}`)}${k.iconBtn('x', `Cancel claim on ${c.name}`, { size: 44 })}</div></li>`;
}
// One note for the group when claims share a drop (product change: the product repeats it under each claim).
const sharedNote = (claims, drop) => `<div role="note" style="display: flex; gap: 10px; align-items: flex-start; border: 2px solid {{t.rule}}; padding: 10px 12px">${warn('{{t.ink}}')}<div style="display: flex; flex-direction: column; gap: 2px"><span style="font-size: 14px; font-weight: 600; text-wrap: pretty">Only one of these can go through: ${claims.map(c => '#' + c.rank).join(' and ')} both drop ${drop}.</span><span style="font-size: 14px; color: {{t.dim}}; text-wrap: pretty">Higher bid first, then Waiver priority, then your Claim order, each at its player's Clear time.</span></div></div>`;
function claimsFrame({ pending = CLAIMS, results = RESULTS, phone = false, error = false } = {}) {
  let body;
  if (error) body = `<p style="margin: 0; padding: 16px 20px; font-size: 15px; color: {{t.dim}}">Your claims could not be loaded.</p>`;
  else if (!pending.length && !results.length) body = `<p tabindex="-1" style="margin: 0; padding: 16px 20px; font-size: 15px; color: {{t.dim}}">No claims yet</p>`;
  else {
    const shared = pending.length > 1 && pending.every(c => c.drop && c.drop === pending[0].drop);
    const pend = pending.length ? `<section aria-label="Pending claims" style="display: flex; flex-direction: column; gap: 4px">${h3s('Pending')}<p style="margin: 0; font-size: 14px; color: {{t.dim}}; text-wrap: pretty">Claim order ranks your own claims. A higher bid still processes first.</p><ol style="list-style: none; margin: 0; padding: 0">${pending.map((c, i) => pendingRow(c, i, pending.length)).join('')}</ol>${shared ? sharedNote(pending, pending[0].drop) : ''}</section>` : '';
    const res = results.length ? `<section aria-label="Results" style="display: flex; flex-direction: column; gap: 8px">${h3s('Results')}${results.map(g => `<div style="display: flex; flex-direction: column"><h4 style="margin: 0 0 2px; font-size: 14px; font-weight: 600; color: {{t.dim}}">${g.week}</h4><ul style="list-style: none; margin: 0; padding: 0">${g.rows.map(([n, r, reason], i) => `<li style="display: flex; flex-direction: column; align-items: flex-start; gap: 6px; padding: 10px 0; border-top: 2px solid {{t.rule}}"><span style="font-size: 15px; font-weight: 600">${n}</span>${resultBlock(r, reason)}</li>`).join('')}</ul></div>`).join('')}</section>` : '';
    body = `<div style="padding: ${phone ? '14px' : '16px 20px 20px'}; display: flex; flex-direction: column; gap: 20px">${pend}${res}</div>`;
  }
  return `<section aria-labelledby="mc-h" data-testid="waivers-claims-card" style="${FRAME2}; min-width: 0">${frameHead(h2s('mc-h', 'My claims'), { phone })}${body}</section>`;
}

// ---- Bye clusters (tertiary frame) ----
function byeFrame({ phone = false } = {}) {
  const tileEl = c => {
    const inv = c.sev === 'warning', bd = c.sev === 'quiet' ? '{{t.rule}}' : '{{t.ink}}';
    return `<li data-testid="bye-cluster-tile" data-week="${c.week}" data-severity="${c.sev}" style="display: flex; flex-direction: column; align-items: center; gap: 4px; box-sizing: border-box; min-height: 84px; padding: 8px 2px; border: 2px solid ${bd}; ${inv ? 'background: {{t.ink}}; color: {{t.panel}}' : c.sev === 'quiet' ? 'color: {{t.dim}}' : ''}"><span style="font-size: 13px; white-space: nowrap">Wk ${c.week}</span><span style="${px(16)}; line-height: 1">${c.count}</span><span style="display: flex; flex-direction: column; align-items: center; font-size: 13px; font-weight: 700; line-height: 1.25">${c.players.map(p => `<span>${p.pos}</span>`).join('')}</span><span style="${SR}">${c.count} on bye${c.sev === 'quiet' ? '' : c.sev === 'notable' ? ', notable' : ', warning'}</span></li>`;
  };
  return `<section aria-labelledby="by-h" data-testid="bye-cluster-grid" style="${FRAME2}; min-width: 0">${frameHead(`${h2s('by-h', 'Bye clusters')}${k.meta(`Wk ${CLUSTERS[0].week} to ${CLUSTERS[6].week}`, 'margin-left: auto')}`, { phone })}<div style="padding: ${phone ? '14px' : '16px 20px 20px'}; display: flex; flex-direction: column; gap: 12px"><ul style="list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px">${CLUSTERS.map(tileEl).join('')}</ul><p data-testid="bye-cluster-line" style="margin: 0; font-size: 14px; color: {{t.dim}}; text-wrap: pretty">${BYE_LINE}</p></div></section>`;
}

// ---- phone: view control (SegmentedControl "Waivers view") and the player card ----
let VC = 0;
const viewControl = ({ selected = 'waivers' } = {}) => (VC++, `<div role="radiogroup" aria-label="Waivers view" style="display: flex">${[['waivers', 'On waivers'], ['claims', 'My claims']].map(([v, t], i) => { const on = v === selected; return `<button type="button" role="radio" aria-checked="${on}"${v === 'claims' ? ` aria-describedby="wv-claims-n${VC}"` : ''} tabindex="${on ? 0 : -1}" style="flex: 1; min-height: 44px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 0 16px; box-sizing: border-box; border-radius: 0; font-family: inherit; font-size: 15px; font-weight: 600; ${i ? 'margin-left: -2px; ' : ''}border: 2px solid ${on ? '{{t.play}}' : '{{t.ink}}'}; background: ${on ? '{{t.play}}' : 'transparent'}; color: ${on ? '{{t.playInk}}' : '{{t.ink}}'}">${on ? arrow() : ''}${t}${v === 'claims' ? ` <span aria-hidden="true" style="font-weight: 400">${CLAIMS.length}</span><span id="wv-claims-n${VC}" style="${SR}">${CLAIMS.length} pending claims</span>` : ''}</button>`; }).join('')}</div>`);
const mcol = (l, v) => `<div style="display: flex; flex-direction: column; gap: 2px"><span style="font-size: 13px; letter-spacing: .04em; text-transform: uppercase; color: {{t.dim}}">${l}</span><span style="font-size: 16px; font-weight: 700; min-height: 24px; display: flex; align-items: center">${v}</span></div>`;
function playerCard(p, { cursor = false, open = false } = {}) {
  const soon = p.rem < 60;
  const top = `<div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px"><div style="min-width: 0; display: flex; align-items: flex-start; gap: 8px">${k.avatar(p.name, { size: 32 })}<div style="min-width: 0; display: flex; flex-direction: column; gap: 2px"><div style="display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px">${nameBtn(p.name).replace('white-space: nowrap', 'white-space: normal')}${p.inj ? injTag(p.inj) : ''}</div><div style="display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px; font-size: 13px; color: {{t.dim}}">${posTag(p.pos)}<span>${p.team}</span><span>${opp(p)}</span></div></div></div><div style="flex: none; text-align: right">${status(p).replace('flex-direction: column', 'flex-direction: column; align-items: flex-end')}</div></div>`;
  const metrics = `<div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 12px"><div style="display: flex; gap: 16px">${mcol('Proj Wk', projCell(p))}${mcol('ROS', f1(p.ros))}${p.up > 0 ? mcol('Upgrade', upPill(p)) : ''}</div>${spark(p, { w: 4 })}</div>`;
  const actions = `<div style="display: flex; justify-content: flex-end; align-items: center; gap: 4px">${expandBtn(p, open, 44)}${claimBtn(p, { fill: cursor, size: 44 })}</div>`;
  const inner = `<div style="display: flex; flex-direction: column; gap: 12px">${top}${metrics}${actions}</div>`;
  return cursor
    ? `<div data-testid="player-row-card" class="cursor" style="border: 4px solid ${soon ? '{{t.danger}}' : '{{t.cursor}}'}; background: {{t.panel}}; padding: 8px 10px; box-sizing: border-box"><span style="${SR}">Your next move: the largest Upgrade you have not claimed</span>${inner}</div>`
    : `<div data-testid="player-row-card" style="border: 2px solid {{t.frame2}}; background: {{t.panel}}; padding: 10px 12px; box-sizing: border-box">${inner}</div>`;
}
const phoneControls = () => `<div style="display: flex; flex-direction: column; gap: 10px">${k.field({ id: 'wp-q', label: 'Search players', placeholder: 'Search by name' })}<div>${k.btnGhost('Filters')}</div></div>`;

// ---- claim sheet (dialog from sm, full screen below 600) ----
const radioRow = (name, label, on, id) => `<label style="display: flex; align-items: center; gap: 12px; min-height: 44px; font-size: 15px; cursor: pointer"><input type="radio" name="${name}" ${on ? 'checked ' : ''}style="${SR}"><span aria-hidden="true" style="width: 20px; height: 20px; flex: none; box-sizing: border-box; border: 2px solid {{t.ink}}; border-radius: 50%; display: grid; place-items: center">${on ? '<span style="width: 8px; height: 8px; border-radius: 50%; background: {{t.ink}}"></span>' : ''}</span><span style="${on ? 'font-weight: 700' : ''}">${label}</span></label>`;
function claimSheet({ id, verb, name, p, dropped = null, atCap = true, bid = '0', remaining = 62, bidError = false, edit = false, priority = null, phone = false, rows = 7 }) {
  const list = (atCap ? [] : [['', 'No drop']]).concat(DROPS.map(d => [d.name, `${d.name} (${d.pos}) · ${f1(+d.proj)} proj`]));
  const sel = dropped === null ? '' : dropped;
  const radios = list.map(([v, l]) => radioRow(id + '-drop', l, v === sel && (dropped !== null || (!atCap && v === '')))).join('');
  const net = dropped ? `+${f1(p.up)} this week` : null;
  const swap = swapPreview(p);
  const dropBlock = `<div role="radiogroup" aria-labelledby="${id}-dl" ${atCap ? `aria-describedby="${id}-cap"` : ''} style="display: flex; flex-direction: column"><span id="${id}-dl" style="font-size: 15px; font-weight: 700; margin-bottom: 2px">${atCap ? 'Drop a player' : 'Drop a player (optional)'}</span>${atCap ? `<span id="${id}-cap" style="font-size: 14px; color: {{t.dim}}; margin-bottom: 4px">Your roster is full. Choose a player to drop when this claim clears.</span>` : ''}<div style="max-height: ${rows * 44 + 22}px; overflow-y: auto; border-top: 2px solid {{t.rule}}; border-bottom: 2px solid {{t.rule}}" tabindex="0" aria-label="Players you can drop">${radios}</div></div>`;
  const stepBtn = (aria, ic) => `<button type="button" aria-label="${aria}" style="width: 44px; height: 44px; padding: 0; display: grid; place-items: center; box-sizing: border-box; border-radius: 0; background: transparent; border: 2px solid {{t.ink}}; color: {{t.ink}}"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="${ic}" fill="currentColor"/></svg></button>`;
  const bidBlock = priority != null
    ? `<p style="margin: 0; font-size: 15px">Waiver priority #${priority}</p>`
    : `<div style="display: flex; flex-direction: column; gap: 6px"><div style="display: flex; flex-wrap: wrap; align-items: flex-end; gap: 8px">${stepBtn('Lower bid', 'M1 5h10v2H1z')}<div style="display: flex; flex-direction: column; gap: 4px"><label for="${id}-bid" style="font-size: 14px; font-weight: 600">Bid</label><input id="${id}-bid" type="text" inputmode="numeric" value="${bid}"${bidError ? ' aria-invalid="true" aria-describedby="' + id + '-err"' : ''} style="box-sizing: border-box; width: 96px; height: 44px; border-radius: 0; background: {{t.bg}}; color: {{t.ink}}; border: 2px solid ${bidError ? '{{t.danger}}' : '{{t.dim}}'}; font-family: inherit; font-size: 16px; font-weight: 600; padding: 0 12px; text-align: center"></div>${stepBtn('Raise bid', 'M5 1h2v4h4v2H7v4H5V7H1V5h4z')}${k.btnGhost('$1', { aria: 'Bid $1' })}${k.btnGhost('Max', { aria: 'Bid max' })}</div>${bidError ? `<div id="${id}-err" style="display: flex; gap: 8px; align-items: flex-start; font-size: 14px">${warn('{{t.danger}}')}<span>Enter a whole-dollar bid between $0 and $${remaining}</span></div>` : ''}<span style="font-size: 14px; color: {{t.dim}}">$${remaining} remaining</span></div>`;
  const blocked = bidError || (atCap && dropped === null);
  const submit = blocked ? btnDis(edit ? 'Save claim' : 'Submit claim') : k.btnFill(edit ? 'Save claim' : 'Submit claim', { tag: 'button' });
  const wrap = phone ? `${FRAME}; width: 100%; max-width: 390px; min-height: 100%` : `${FRAME}; width: 100%; max-width: 480px`;
  return `<div role="dialog" aria-modal="true" aria-labelledby="${id}-t" style="${wrap}; box-sizing: border-box; display: flex; flex-direction: column"><div style="padding: 14px 20px; border-bottom: 2px solid {{t.rule}}"><h2 id="${id}-t" style="margin: 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px"><span style="${px(16)}">${verb}</span><span style="font-size: 24px; font-weight: 700; line-height: 1.2">${name}</span></h2></div><div style="padding: 20px; display: flex; flex-direction: column; gap: 20px">${swap}${dropBlock}${bidBlock}</div><div style="display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 12px; padding: 14px 20px; border-top: 2px solid {{t.rule}}">${k.btnGhost('Cancel')}${submit}</div></div>`;
}

// Disabled action: a solid Rule edge and Dim text (never dashed: dashed means unsaved).
const btnDis = label => `<button type="button" disabled style="min-height: 44px; display: inline-flex; align-items: center; padding: 0 16px; box-sizing: border-box; border-radius: 0; font-family: inherit; font-size: 15px; font-weight: 600; background: transparent; border: 2px solid {{t.rule}}; color: {{t.dim}}; cursor: not-allowed">${label}</button>`;

// ---- notes helper: the short dashed-rule block each board ends with ----
const alertLine = t => `<div role="alert" style="display: flex; align-items: center; gap: 10px; font-size: 16px">${warn('{{t.danger}}')}${t}</div>`;
const byName = n => POOL.find(p => p.name === n);

module.exports = { ...k, POOL, CURSOR, TOTAL, PAGE, ROSTER_COUNT, CAPACITY, FAAB, CLAIMS, RESULTS, DROPS, CLUSTERS, BYE_LINE, NEXT, NEXT_NOTE, WEEKLY_CLEAR, atRem, TILES_FAAB, PERIOD_H, NOW, until, show, parse, f1, byName, backLink, subline, wvHead, fullChip, tile, summary, controls, sortDir, identity, upPill, status, spark, expandBtn, claimBtn, wvTable, swapPreview, rowDetail, pager, pagerBtn, claimsFrame, byeFrame, viewControl, playerCard, phoneControls, claimSheet, wvChip, alertLine, btnDis, injTag, resultBlock, tileTime, clearNote, h3s, pendingRow, sharedNote };
