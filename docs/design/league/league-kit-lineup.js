// Wave 3 Lineup pieces (ledger row, summary strip, Endzone Forecast panel, bye clusters, matchup preview, phone footer, state specimens).
// Own file: never edit another kit. Product truth: E:/ee-ps-w3-read/src widgets/lineup-ledger, team-summary-strip, start-sit-panel, bye-cluster, matchup-preview, pages/lineup,
// entities/roster (adviceNote, moveLegality, buildLedgerSections), server/services/lineup.service.js (computeEdgeLine).
const k = require('./league-kit-matchup');
const D0 = require('./lineup-data');
const W = require('./week7-games');
const { px, SR, FRAME, frameHead, h2, meta, avatar, posTag, lockIcon, warn, arrow, esc, f1 } = k;
const FRAME2 = 'border: 2px solid {{t.frame2}}; background: {{t.panel}}';
const LG = 'Thursday Night Regulars';
const TOTAL_STARTERS = D0.STARTERS.filter(s => !s.empty).length; // the product's "Locked x of y" counts entries, so an empty slot is not a starter
const EMPTY_SLOT = D0.STARTERS.find(s => s.empty).slot;

// ---- small pictograms (16px, 2px grid) ----
const svg = (d, c = 'currentColor') => `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" shape-rendering="crispEdges" style="flex: none"><path d="${d}" fill="${c}"/></svg>`;
const upIcon = () => svg('M7 2h2v2H7zM5 4h6v2H5zM3 6h10v2H3zM7 8h2v6H7z');
// the product's result icon is a checkered flag (EdgeLineIcon.jsx), for a beat and a miss alike
const flagIcon = () => svg('M3 2h2v13H3zM5 3h2v2H5zM9 3h2v2H9zM7 5h2v2H7zM11 5h2v2h-2zM5 7h2v2H5zM9 7h2v2H9z');
const EDGE_ICON = { injury: () => warn('currentColor'), 'bench-above-starter': upIcon, pace: () => k.clock('currentColor'), result: flagIcon };

// ---- injury tag: the product's codes (Q, D, O, IR) with the status named for screen readers; Out is the filled Ink chip ----
const INJ = { Questionable: ['Q', 'Questionable'], Doubtful: ['D', 'Doubtful'], Out: ['O', 'Out'], 'Injured reserve': ['IR', 'Injured reserve'] };
const injCode = word => { const [c, name] = INJ[word] || [word, word]; return `<span style="display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; min-width: 24px; height: 22px; padding: 0 5px; border: 2px solid ${word === 'Out' ? '{{t.ink}}' : 'currentColor'}; ${word === 'Out' ? 'background: {{t.ink}}; color: {{t.bg}}; ' : ''}font-size: 13px; font-weight: 700; letter-spacing: .04em; line-height: 1; flex: none"><span aria-hidden="true">${c}</span><span style="${SR}">Injury status: ${name}</span></span>`; };
// A small outlined word tag (Backup, Attested, Spent): Archivo 13 700 uppercase.
const wordTag = (t, dashed = false) => `<span style="display: inline-flex; align-items: center; box-sizing: border-box; height: 22px; padding: 0 6px; border: 2px ${dashed ? 'dashed' : 'solid'} currentColor; font-size: 13px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; line-height: 1; flex: none">${t}</span>`;

// ---- slot labels as buildLedgerSections derives them: "RB 1", "RB 2" where a slot has more than one seat, the bare key otherwise ----
const baseOf = s => s.split(' ')[0];
const SLOT_LABEL = new Map();
for (const e of D0.STARTERS) { const b = baseOf(e.slot), seats = D0.STARTERS.filter(x => baseOf(x.slot) === b); SLOT_LABEL.set(e, seats.length > 1 ? `${b} ${seats.indexOf(e) + 1}` : b); }
const labelOf = e => SLOT_LABEL.get(e) || e.slot;

// ---- game detail line in the product's format (gameCell.js lineTextFor + weatherTextFor): "{fav} -{spread} · O/U {total}" then "Dome", or "{temp}° · rain · wind {n}" (wind from 10 mph) ----
function detailOf(team) {
  const g = W.gameOf(team);
  if (!g) return '';
  const line = `${g.line.fav} -${g.line.spread} · O/U ${g.line.total}`;
  if (g.venue.indoor) return `${line} · Dome`;
  const t = /(\d+)°/.exec(g.weather), wind = /wind (\d+)/.exec(g.weather);
  const parts = [t && `${t[1]}°`, /rain/i.test(g.weather) && 'rain', /snow/i.test(g.weather) && 'snow', wind && +wind[1] >= 10 && `wind ${wind[1]}`].filter(Boolean);
  return parts.length ? `${line} · ${parts.join(' · ')}` : line;
}

// ---- row model: what one ledger row says at a clock (9 = 9:10 AM, 240 = 2:40 PM) ----
const teamOf = e => e.sub.split(' · ')[1];
// shortcut: bench live points are held in league-kit-matchup.js (BENCH_LIVE, not exported); read them back from its own bench column so the two boards cannot disagree. Re-export BENCH_LIVE there if this ever breaks.
const benchPts = e => { const m = /<b style="font-size: 16px; font-weight: 700">([\d.]+)<\/b>/.exec(k.benchCol([[e.name, e.pos, teamOf(e), +e.proj]], 'x', { live: true })); return m ? +m[1] : null; };
function rowModel(e, clock, idx) {
  if (e.empty) return { empty: true };
  if (e.model && e.model.status) return { ball: '', pts: null, ...e.model }; // specimen rows state their own game
  const team = teamOf(e), g = W.gameOf(team);
  const unavailable = e.inj === 'Out' || !!e.bye || e.slot === 'IR';
  const reason = e.slot === 'IR' ? 'On IR' : e.bye ? 'On bye' : e.inj === 'Out' ? 'Out' : null;
  const st = g ? W.stateAt(g, clock) : null;
  const status = st ? st.status : 'bye';
  const locked = !!g && status !== 'scheduled';
  let pts = null;
  if (status !== 'scheduled' && status !== 'bye') pts = e.slot === 'BENCH' ? benchPts(e) : D0.ME[idx][5];
  const home = g && g.home === team;
  const score = st && st.homeScore != null ? (home ? st.homeScore + '-' + st.awayScore : st.awayScore + '-' + st.homeScore) : null;
  const ball = st && st.possession ? st.possession + ' ball' + (st.downDistance ? ' · ' + st.downDistance.replace(/&/g, '&amp;') : '') : '';
  return { team, g, st, status, unavailable, reason, locked, pts, score, ball, ...(e.model || {}) };
}

// ---- Edge line (server computeEdgeLine, lineup.service.js:1276): first match wins: injury, bench-above-starter (bench rows only), factor (none in this fixture), pace (game in progress), result (final) ----
const round2 = n => String(Math.round(n * 100) / 100);
const posOf = e => e.pos || e.sub.split(' · ')[0];
const slotFits = (slot, pos) => { const b = baseOf(slot); return b === 'FLEX' ? ['RB', 'WR', 'TE'].includes(pos) : b === pos; };
const BY_POS_NAME = [...D0.STARTERS, ...D0.BENCH, ...D0.IR].filter(e => !e.empty).sort((a, b) => posOf(a).localeCompare(posOf(b)) || a.name.localeCompare(b.name));
function edgeOf(e, m) {
  if (e.edge !== undefined) return e.edge;
  const injName = { Questionable: 'questionable', Doubtful: 'doubtful', Out: 'out', 'Injured reserve': 'injured reserve' }[e.inj];
  if (injName) return { kind: 'injury', text: injName };
  if (e.slot === 'BENCH' && !m.unavailable) {
    for (const o of BY_POS_NAME) {
      if (o.slot === 'BENCH' || o.slot === 'IR' || o.empty) continue;
      const om = { unavailable: o.inj === 'Out' || !!o.bye };
      if (om.unavailable || !slotFits(o.slot, posOf(e))) continue;
      if (+e.proj > +o.proj) return { kind: 'bench-above-starter', text: `Outprojects ${o.name} at ${baseOf(o.slot)}` };
    }
  }
  if (m.status === 'live' && +e.proj > 0 && m.pts != null) return { kind: 'pace', text: `${Math.round(m.pts / +e.proj * 100)}% of projection so far (${round2(m.pts)} of ${round2(+e.proj)} pts)` };
  if (m.status === 'final' && m.pts != null) { const d = Math.round((m.pts - +e.proj) * 100) / 100; return { kind: 'result', text: `${d >= 0 ? 'Beat' : 'Fell short of'} projection by ${round2(Math.abs(d))} pts (${round2(m.pts)} of ${round2(+e.proj)})` }; }
  return null;
}

// ---- ledger row (LedgerRow): one <button aria-pressed> under the content; name and Drop are their own buttons on top ----
const HIT = 'position: absolute; inset: 0; width: 100%; height: 100%; padding: 0; margin: 0; border: 0; border-radius: 0; background: transparent';
function ledgerRow(e, { idx = 0, clock = 9, phone = false, mode = 'normal', cursor = false, last = false, note = '' } = {}) {
  const m = rowModel(e, clock, idx);
  const hi = mode === 'eligible', dim = mode === 'dim', moving = mode === 'moving';
  const cur = cursor || moving;
  const urgent = cursor === 'urgent';
  const dm = hi ? '{{t.playDim}}' : '{{t.dim}}', nm = dim ? '{{t.dim}}' : 'inherit';
  const off = dim || m.locked;
  const lblTxt = e.label || labelOf(e);
  const reasonLc = m.reason ? m.reason.replace(/^On /, 'on ').replace(/^Out$/, 'out').replace(/^Backup$/, 'backup') : '';
  const desig = !m.empty && !m.unavailable && e.inj ? { Questionable: 'questionable', Doubtful: 'doubtful' }[e.inj] : '';
  // the product's accessible name: "{name}, {slot}, locked, {unavailable}, {injury}, projected {x}"
  const rowName = m.empty ? `Empty ${lblTxt} slot` : [e.name, lblTxt, m.locked && 'locked', m.unavailable && reasonLc, desig, !m.unavailable && `projected ${e.proj}`].filter(Boolean).join(', ');
  const hit = `<button type="button" class="rowhit" aria-pressed="${moving}" aria-label="${esc(rowName)}${dim ? ', not eligible' : ''}"${dim ? ' aria-disabled="true"' : ''} style="${HIT}; cursor: ${off ? 'not-allowed' : 'pointer'}"></button>`;
  const lbl = `<span style="flex: none; width: ${phone ? 46 : 52}px; font-size: 13px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: ${nm}">${lblTxt}</span>`;
  const sz = 44;
  if (m.empty) {
    const inner = `<div style="position: relative; pointer-events: none; display: flex; align-items: center; gap: ${phone ? 8 : 12}px; min-height: 52px">${lbl}<span style="font-size: 15px; color: ${dm}">Empty</span></div>`;
    return rowShell({ hi, cur, urgent, last, dim, body: hit + inner, note });
  }
  // 44px name button (a 15px line plus 12px of padding either side)
  // exactly 44px tall (min-height) without growing the row: negative margins give back what the hit area adds; the name never wraps (a phone truncates with an ellipsis, the tags beside it never move)
  const nameBtn = `<button type="button" aria-label="${esc(e.name)}" style="pointer-events: auto; min-height: 44px; box-sizing: border-box; display: inline-flex; align-items: center; padding: 0; margin: -13px 0; border: 0; border-radius: 0; background: none; color: ${nm}; font: inherit; font-size: 15px; font-weight: 600; line-height: 18px; text-align: left; white-space: nowrap; min-width: 0; ${phone ? 'overflow: hidden; text-overflow: ellipsis; display: block; line-height: 44px; ' : ''}cursor: pointer">${e.name}</button>`;
  const lockSpan = m.locked ? `<span style="display: inline-flex; align-items: center; flex: none">${lockIcon()}<span style="${SR}">Locked: this player's game has kicked off</span></span>` : '';
  let g1 = '', g2 = '';
  if (m.unavailable) g1 = `<span style="display: inline-flex; align-items: center; box-sizing: border-box; min-height: 28px; padding: 0 8px; border: 2px solid {{t.rule}}; font-size: 14px; font-weight: 600">${m.reason}</span>`;
  else if (m.status === 'live') { g1 = `<span style="display: inline-flex; align-items: center; gap: 8px; white-space: nowrap"><span aria-hidden="true" style="width: 8px; height: 8px; flex: none; background: {{t.accent}}"></span><span style="${SR}">Live, </span>${m.score} · ${m.st.clock}</span>`; g2 = m.ball; }
  else if (m.status === 'final') g1 = `Final ${m.score}`;
  else { g1 = e.game; g2 = detailOf(m.team); }
  const edge = edgeOf(e, m);
  const edgeHtml = edge ? `<div data-testid="ledger-edge-line" data-edge-kind="${edge.kind}" style="display: flex; align-items: flex-start; gap: 6px; font-size: 13px; font-weight: 600; color: ${edge.kind === 'injury' ? 'inherit' : dm}; padding: 0 0 6px">${EDGE_ICON[edge.kind]()}<span style="text-wrap: pretty">${edge.text}</span></div>` : '';
  const tags = (e.tags || []).join('');
  const av = k.avatar(e.name, { size: phone ? 28 : 36, c: hi ? 'currentColor' : '{{t.dim}}' });
  const nameLine = `<div style="display: flex; align-items: center; ${phone ? 'flex-wrap: nowrap' : 'flex-wrap: wrap'}; gap: 4px 8px; min-width: 0">${nameBtn}${phone ? '' : (e.inj ? injCode(e.inj) : '') + tags}${lockSpan}</div>`;
  const who = `<div style="min-width: 0">${nameLine}<div style="font-size: 13px; color: ${dm}; ${phone ? 'display: flex; align-items: center; flex-wrap: wrap; gap: 2px 6px; ' : ''}">${phone ? (e.inj ? injCode(e.inj) : '') + tags : ''}<span>${e.sub}</span></div>${phone ? '' : ''}</div>`;
  const gcell = `<div style="min-width: 0"><div style="font-size: 14px; font-weight: 600; ${m.unavailable ? '' : 'white-space: nowrap'}">${g1}</div>${g2 ? `<div style="font-size: 13px; color: ${dm}">${g2}</div>` : ''}</div>`;
  const ptsTxt = m.unavailable || m.pts == null ? `<span aria-hidden="true">-</span><span style="${SR}">Points not available yet</span>` : f1(m.pts);
  const fin = m.status === 'final' && !m.unavailable;
  const l2 = m.unavailable ? reasonLc : 'proj ' + e.proj;
  const fig = `<div style="text-align: right; flex: none"><div style="font-size: 16px; font-weight: 700; color: ${nm}">${ptsTxt}${fin ? ` <span style="font-size: 13px; font-weight: 400; color: ${dm}; white-space: nowrap">pts · final</span>` : ''}</div><div style="font-size: 13px; color: ${dm}; white-space: nowrap">${l2}</div></div>`;
  // the product keeps Drop on every occupied row of the current week that is not spent (locked rows included)
  let drop = e.noDrop ? '' : k.iconBtn('trash', `Drop ${e.name}`, { size: sz, quiet: true }).replace('style="', 'style="pointer-events: auto; ');
  if (hi) drop = drop.replace('color: {{t.dim}}', 'color: inherit');
  const inner = phone
    ? `<div style="position: relative; pointer-events: none; display: grid; grid-template-columns: 46px 28px minmax(0, 1fr) auto 44px; align-items: center; column-gap: 4px; min-height: 52px">${lbl}${av}<div style="min-width: 0; padding-left: 4px">${who}</div>${fig}<span style="display: inline-flex; justify-content: flex-end">${drop}</span><div style="grid-column: 2 / -1; display: flex; flex-direction: column; gap: 1px; padding: 0 0 8px; font-size: 13px; color: ${dm}"><div style="white-space: nowrap">${m.unavailable ? m.reason : g1}</div>${g2 && !m.unavailable ? `<div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis">${g2}</div>` : ''}${edgeHtml ? `<div style="margin-top: 3px">${edgeHtml.replace('padding: 0 0 6px', 'padding: 0')}</div>` : ''}</div></div>`
    : `<div style="position: relative; pointer-events: none; display: grid; grid-template-columns: 52px 36px minmax(0, 1fr) minmax(0, 1.15fr) 96px 44px; align-items: center; gap: 0 12px; min-height: 52px; padding: 2px 0">${lbl}${av}${who}${gcell}${fig}<div style="display: flex; justify-content: flex-end">${drop}</div>${edgeHtml ? `<div style="grid-column: 3 / 5; margin-top: -2px">${edgeHtml}</div>` : ''}</div>`;
  return rowShell({ hi, cur, urgent, last, dim, body: hit + inner, note });
}
function rowShell({ hi, cur, urgent, last, dim, body, note }) {
  const c = urgent ? '{{t.danger}}' : '{{t.cursor}}';
  return `<li style="${last ? '' : `border-bottom: 2px ${dim ? 'dashed' : 'solid'} {{t.rule}}`}"><div class="${cur ? 'cursor ' : ''}slot" style="position: relative; --cur: ${c}; border: 4px solid ${cur ? c : 'transparent'}; box-sizing: border-box; ${hi ? 'background: {{t.play}}; color: {{t.playInk}}; ' : ''}"><div style="position: relative; padding: 0 8px">${body}</div>${note ? `<div style="padding: 0 8px 8px">${note}</div>` : ''}</div></li>`;
}

// ---- ledger frames: Starters (primary), IR and Bench ----
// Starters is the page's main board (6px double, Pixel 24 h2); IR is a tertiary frame (2px, Pixel 16 h2); Bench is primary like Starters.
const ledgerFrame = (id, title, rows, { phone = false, tier = 'primary' } = {}) => tier === 'tertiary'
  ? `<section aria-labelledby="${id}" data-testid="${id}" style="${FRAME2}; min-width: 0">${frameHead(`<h2 id="${id}" style="margin: 0; ${px(16)}">${title}</h2>`, { phone })}<ul style="list-style: none; margin: 0; padding: ${phone ? '2px 6px 6px' : '4px 12px 8px'}">${rows.join('')}</ul></section>`
  : `<section aria-labelledby="${id}" data-testid="${id}" style="${FRAME}; min-width: 0">${frameHead(h2(id, title, { phone }), { phone })}<ul style="list-style: none; margin: 0; padding: ${phone ? '2px 6px 6px' : '4px 12px 8px'}">${rows.join('')}</ul></section>`;
const startersFrame = (opts = {}) => ledgerFrame(`ls-h${opts.uid || ''}`, 'Starters', D0.STARTERS.map((e, i) => ledgerRow(e, { idx: i, ...(opts.row ? opts.row(e, i) : {}), clock: opts.clock, phone: opts.phone, last: i === D0.STARTERS.length - 1 })), { phone: opts.phone });
const irFrame = (opts = {}) => ledgerFrame(`li-h${opts.uid || ''}`, 'IR', D0.IR.map((e, i) => ledgerRow(e, { clock: opts.clock, phone: opts.phone, last: true, ...(opts.row ? opts.row(e, i) : {}) })), { phone: opts.phone, tier: 'tertiary' });
// The Bench card's own "Bench points this season" line is gone: it is the same quantity as the Forecast's "Left on the bench this season" (hindsight totalPointsLeftOnBench), so the Forecast says it once.
const benchFrame = (opts = {}) => ledgerFrame(`lb-h${opts.uid || ''}`, 'Bench', D0.BENCH.map((e, i) => ledgerRow(e, { clock: opts.clock, phone: opts.phone, last: i === D0.BENCH.length - 1, ...(opts.row ? opts.row(e, i) : {}) })), { phone: opts.phone });

// ---- team summary strip: card "This week" ----
const T = D0.LIVE_TOTALS;
const stripTile = (l, v, phone) => `<div style="display: flex; flex-direction: column; gap: 2px; min-width: 0"><span style="font-size: 13px; color: {{t.dim}}">${l}</span><span style="font-size: ${phone ? 16 : 18}px; font-weight: 700; font-variant-numeric: tabular-nums">${v}</span></div>`;
const attn = (t, { warnIcon = false } = {}) => `<span style="display: inline-flex; align-items: center; gap: 6px; min-height: 28px; box-sizing: border-box; padding: 0 8px; border: 2px solid {{t.ink}}; font-size: 13px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase">${warnIcon ? warn('currentColor') : ''}${t}</span>`;
// Bye clusters: rostered players, IR excluded, grouped by bye week for the seven weeks after the viewed week (shared/lib/byeClusters.js).
const CLUSTERS = Array.from({ length: 7 }, (_, i) => {
  const week = 8 + i;
  const players = [...D0.STARTERS, ...D0.BENCH].filter(e => !e.empty && D0.BYE[teamOf(e)] === week).map(e => ({ name: e.name, pos: e.pos || e.sub.split(' · ')[0] }));
  return { week, count: players.length, players, sev: players.length >= 3 ? 'warning' : players.length === 2 ? 'notable' : 'quiet' };
});
const WORST = CLUSTERS.filter(c => c.count >= 2).reduce((w, c) => (c.count > w.count ? c : w), CLUSTERS.find(c => c.count >= 2));
const joinNames = n => n.length <= 1 ? n[0] : n.length === 2 ? n.join(' and ') : n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1];
// This league clears waivers on a blanket weekly schedule, so the line names the clear time instead of the product's "in {n} hours" (a product copy change).
const worstLine = `Week ${WORST.week}: ${joinNames(WORST.players.map(p => p.name))} sit. Waivers clear Wed 2:00 AM.`;

function summaryStrip({ clock = 9, phone = false, uid = '' } = {}) {
  const live = clock === 240;
  const pre = D0.SUMMARY;
  const me = live ? f1(T.meNow) + ' / ' + f1(T.meExp) : '0.0 / ' + f1(pre.meProj), opp = live ? f1(T.oppNow) + ' / ' + f1(T.oppExp) : '0.0 / ' + f1(pre.oppProj);
  const left = live ? T.meLeft : D0.PRE_LEFT.me;
  const locked = live ? D0.STARTERS.filter((e, i) => !e.empty && rowModel(e, 240, i).locked).length : 0;
  const pct = live ? T.pct : pre.pct;
  const advice = live ? 'No bench move' : `+${D0.ADVICE.gain} pts · ${D0.plural(D0.ADVICE.swaps, 'swap')}`;
  const chips = `${attn('Marks Q')}${attn(`Wk ${WORST.week} · ${WORST.count} byes`, { warnIcon: true })}`;
  return `<section aria-labelledby="ts-h${uid}" data-testid="team-summary-strip" style="${FRAME2}; min-width: 0">${frameHead(`<h2 id="ts-h${uid}" style="margin: 0; ${px(16)}">This week</h2>`, { phone })}
<div style="padding: ${phone ? '12px 14px' : '14px 20px'}; display: flex; flex-direction: column; gap: 12px">
<div style="display: grid; grid-template-columns: repeat(${phone ? 2 : 4}, minmax(0, 1fr)); gap: 12px 16px">${stripTile('Score vs proj.', me, phone)}${stripTile('Opponent vs proj.', opp, phone)}${stripTile('Starters', left + ' to play', phone)}${stripTile('Locked', locked + ' of ' + TOTAL_STARTERS, phone)}</div>
<p style="margin: 0; font-size: 14px; color: {{t.dim}}"><b style="font-weight: 700; color: {{t.ink}}">Win probability ${pct}%</b> · <span style="white-space: nowrap">Endzone Forecast</span></p>
<div data-testid="strip-attention" style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px"><span style="font-size: 13px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: {{t.dim}}">Watch</span>${chips}</div>
<div data-testid="strip-advice" style="display: flex; flex-direction: column; gap: 2px; border-top: 2px solid {{t.rule}}; padding-top: 10px"><span style="font-size: 13px; color: {{t.dim}}">Advice</span><span style="font-size: ${phone ? 15 : 16}px; font-weight: 700; text-wrap: pretty">${advice}</span></div>
</div></section>`;
}

// ---- Endzone Forecast panel (StartSitPanel) ----
const statLine = (l, v) => `<div style="display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; border-top: 2px solid {{t.rule}}; font-size: 14px"><span style="color: {{t.dim}}">${l}</span><b style="font-weight: 600; text-align: right; white-space: nowrap">${v}</b></div>`;
// The season points left on the bench (hindsight totalPointsLeftOnBench) lives here once; the Bench card no longer repeats it.
const forecastStats = () => `<div style="display: flex; flex-direction: column">${statLine('Left on the bench this season', D0.LEFT_ON_BENCH)}${statLine('You vs the Forecast', '3-2')}${statLine('Called shots this season', '2 of 3 · streak 1')}</div>`;
// Lean line (projectedLeanLine): only when the Expected-final gap is 10 or more.
const leanLine = text => `<p data-testid="start-sit-lean-line" style="margin: 0; font-size: 15px; font-weight: 600">${text}</p>`;
// Suggestion card, drawn to the product (head: slot, verdict, "about n%", "+gain"; Sit and Start columns; opponent context; Decide by; actions). No fact chips here: no game reaches a threshold.
function suggestionCard({ phone = false } = {}) {
  const lab = t => `<span style="font-size: 13px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: {{t.dim}}">${t}</span>`;
  const name = (n, inj) => `<div style="display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px"><span style="font-size: 15px; font-weight: 600">${n}</span>${inj ? injCode(inj) : ''}</div>`;
  const kick = '<div style="font-size: 13px; color: {{t.dim}}">Sun ' + D0.FIRST_LOCK + '</div>';
  const opp = t => `<div style="font-size: 13px; color: {{t.dim}}">${t}</div>`;
  const cells = [[lab('Sit'), lab('Start')], [name('Puka Nacua', 'Out'), name('Jordan Addison')], [k.rangeBar({ floor: 0, proj: 0, ceil: 0, max: 24 }), k.rangeBar({ floor: 3.2, proj: 10.1, ceil: 19.4, max: 24 })], [kick, kick], [opp('vs JAX'), opp('vs PHI')]];
  return `<div data-testid="suggestion-card" style="border: 2px solid {{t.ink}}; display: flex; flex-direction: column">
<div style="display: flex; flex-wrap: ${phone ? 'wrap' : 'nowrap'}; align-items: center; gap: 6px 8px; padding: 10px 12px; border-bottom: 2px solid {{t.rule}}"><span style="display: inline-flex; align-items: center; height: 24px; padding: 0 6px; box-sizing: border-box; border: 2px solid {{t.rule}}; font-size: 13px; font-weight: 700; letter-spacing: .04em; line-height: 1; flex: none">WR</span><span style="${px(16)}; white-space: nowrap">Strong start</span><span style="margin-left: auto; font-size: 13px; color: {{t.dim}}; white-space: nowrap">about 90% · +10.1 pts</span></div>
<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 24px; padding: 12px">${cells.flat().join('')}</div>
<div style="display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-top: 2px solid {{t.rule}}; font-size: 14px; font-weight: 600">${k.clock('currentColor')}Decide by Sun ${D0.FIRST_LOCK}</div>
<div style="display: flex; flex-wrap: wrap; gap: 8px; padding: 0 12px 12px">${k.btnGhost('Compare', { aria: 'Compare Jordan Addison with Puka Nacua' })}${k.btnGhost('Dismiss')}${k.btnGhost('Call your shot', { aria: 'Call your shot: keep Puka Nacua over Jordan Addison' })}</div>
</div>`;
}
// A separator stays with the word before it (a line may end with the dot, never start with one).
const glueDots = t => t.replace(/(\S+) · /g, '<span style="white-space: nowrap">$1&nbsp;·</span> ');
// mode: 'pre' (the move plan has two moves), 'live' (nothing on the bench can move: the empty-state line says so), 'set' (nothing is open: "Lineup set").
// The plan line is adviceNote({ suggestions, openSlotFills }) (entities/roster/model/adviceNote.js): two moves read "Two moves · +23.0 pts: Addison in for Puka Nacua (Out) · Spears into the empty FLEX"; it is D0.SWAP.line, the same sentence, and it appears once, above Apply.
function forecastPanel({ mode = 'pre', phone = false, shot = '', lean = '', uid = '' } = {}) {
  const pre = mode === 'pre';
  const apply = `<div style="display: flex; flex-direction: column; gap: 10px; align-items: flex-start"><p style="margin: 0; font-size: 15px; font-weight: 600; text-wrap: pretty">${glueDots(D0.SWAP.line)}</p>${k.btnFill('Apply', { tag: 'button' })}</div>`;
  const emptyText = mode === 'set' ? 'Lineup set' : 'No move from your bench';
  const body = pre
    ? `${lean}${forecastStats()}${shot}${suggestionCard({ phone })}${apply}`
    : `${lean}${forecastStats()}${shot}<p data-testid="start-sit-panel-empty" style="margin: 0; font-size: 15px; color: {{t.dim}}">${emptyText}</p>`;
  return `<section aria-labelledby="ef-h${uid}" data-testid="start-sit-panel" style="${FRAME2}; min-width: 0">${frameHead(`<h2 id="ef-h${uid}" style="margin: 0; ${px(16)}">Endzone Forecast</h2>`, { phone })}<div style="padding: ${phone ? '14px' : '12px'}; display: flex; flex-direction: column; gap: 14px">${body}</div></section>`;
}

// ---- bye clusters (ByeClusterGrid): 7 tiles for the weeks after the viewed week, then the worst cluster named ----
function byeClusters({ phone = false, uid = '' } = {}) {
  const tile = c => {
    const cls = c.sev === 'warning' ? 'background: {{t.ink}}; color: {{t.panel}}; border: 2px solid {{t.ink}}' : c.sev === 'notable' ? 'border: 2px solid {{t.ink}}' : 'border: 2px solid {{t.rule}}; color: {{t.dim}}';
    const word = c.sev === 'warning' ? 'warning' : c.sev === 'notable' ? 'notable' : '';
    return `<li data-testid="bye-cluster-tile" data-severity="${c.sev}" style="${cls}; box-sizing: border-box; min-height: 72px; padding: 8px 2px; display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 0"><span style="font-size: 13px; font-weight: 600; white-space: nowrap">Wk ${c.week}</span><span style="font-size: 18px; font-weight: 700; line-height: 1">${c.count}<span style="${SR}"> on bye${word ? ', ' + word : ''}</span></span><span aria-hidden="true" style="font-size: 13px; font-weight: 700; text-align: center; line-height: 1.2; word-break: break-word">${c.players.map(p => p.pos).join(' ')}</span></li>`;
  };
  return `<section aria-labelledby="by-h${uid}" data-testid="bye-cluster-grid" style="${FRAME2}; min-width: 0">${frameHead(`<h2 id="by-h${uid}" style="margin: 0; ${px(16)}">Bye clusters</h2>${meta(`Wk ${CLUSTERS[0].week} to ${CLUSTERS[6].week}`, 'margin-left: auto')}`, { phone })}
<ul style="list-style: none; margin: 0; padding: ${phone ? '12px 14px 8px' : '14px 16px 8px'}; display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px">${CLUSTERS.map(tile).join('')}</ul>
<p data-testid="bye-cluster-line" style="margin: 0; padding: 4px ${phone ? 14 : 16}px 14px; font-size: 14px; text-wrap: pretty">${worstLine}</p></section>`;
}

// ---- matchup preview (MatchupPreview): framed before kickoff, Board black once the game is on ----
// The live line "Ahead now, projected to trail by 7.9" is this board's own sentence in place of the server narrative (the Game Center hero's first clause); before kickoff the margin line is dropped (not a product field).
function matchupPreview({ mode = 'pre', phone = false, uid = '' } = {}) {
  const S = D0.SUMMARY, live = mode === 'live';
  if (!live) {
    const side = (n, fig, left, right) => `<div style="min-width: 0; text-align: ${right ? 'right' : 'left'}"><h3 style="margin: 0; ${px(16)}; overflow-wrap: anywhere">${n}</h3><div style="font-size: 13px; color: {{t.dim}}; margin-top: 8px">Proj</div><div style="${px(24)}; line-height: 1.3">${fig}</div><div style="font-size: 13px; color: {{t.dim}}">${left} starters set to play</div></div>`;
    return `<section aria-labelledby="mp-h${uid}" data-testid="matchup-preview" style="${FRAME2}; min-width: 0">${frameHead(`<h2 id="mp-h${uid}" style="margin: 0; ${px(16)}">Week 7 Matchup</h2>${meta('Kicks off Sun ' + D0.FIRST_LOCK, 'margin-left: auto')}`, { phone })}
<div style="padding: ${phone ? 14 : 16}px; display: flex; flex-direction: column; gap: 16px"><div style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px">${side('Darkness Falls', f1(S.meProj), D0.PRE_LEFT.me)}${side('Sunday Scaries', f1(S.oppProj), D0.PRE_LEFT.opp, true)}</div>
${k.twoSided('Darkness Falls', 'Sunday Scaries', S.pct, { on: 'page', caption: 'Win probability · <span style="white-space: nowrap">Endzone Forecast</span>', size: 13 })}
<div style="margin-left: -10px">${k.link('Matchup', 'Open the Week 7 matchup')}</div></div></section>`;
  }
  const B = { ink: '{{t.boardInk}}', dim: '{{t.boardDim}}' };
  const me = T.lead >= 0;
  const side = (n, score, exp, left, lead, right) => `<div style="min-width: 0; text-align: ${right ? 'right' : 'left'}"><h3 style="margin: 0; ${px(16, lead ? B.ink : B.dim)}; overflow-wrap: anywhere">${n}</h3><div style="${px(24, lead ? B.ink : B.dim)}; line-height: 1.3; margin-top: 4px">${f1(score)}</div><div style="font-size: 13px; color: ${B.dim}; margin-top: 4px">Expected final ${f1(exp)}</div><div style="font-size: 13px; color: ${B.dim}">${left} players remaining</div></div>`;
  const gap = T.oppExp - T.meExp;
  return `<section aria-labelledby="mp-h${uid}" data-testid="matchup-preview" style="background: {{t.board}}; color: ${B.ink}; border: 2px solid ${B.dim}; min-width: 0"><p aria-live="polite" style="margin: 0; ${SR}">${k.sentence(T.meNow, T.oppNow)}</p>
<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: ${phone ? '12px 14px' : '14px 20px'}; border-bottom: 2px solid {{t.boardRule}}"><h2 id="mp-h${uid}" style="margin: 0; ${px(16)}">Week 7 Matchup</h2><span style="margin-left: auto">${k.liveChipBoard('Live')}</span></div>
<div style="padding: ${phone ? 14 : 16}px; display: flex; flex-direction: column; gap: 14px"><div style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px">${side('Darkness Falls', T.meNow, T.meExp, T.meLeft, me)}${side('Sunday Scaries', T.oppNow, T.oppExp, T.oppLeft, !me, true)}</div>
${k.twoSided('Darkness Falls', 'Sunday Scaries', T.pct, { on: 'board', caption: 'Win probability · <span style="white-space: nowrap">Endzone Forecast</span>', size: 13 })}
<div style="font-size: 15px; font-weight: 600">${me ? 'Ahead now' : 'Behind now'}, projected to ${gap > 0 ? 'trail' : 'lead'} by ${f1(Math.abs(gap))}</div>
<div style="margin-left: -10px"><a href="#" aria-label="Open the Week 7 matchup" style="min-height: 44px; display: inline-flex; align-items: center; padding: 0 10px; font-size: 15px; font-weight: 600; color: ${B.ink}; text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 5px; text-decoration-color: ${B.dim}">Matchup</a></div></div></section>`;
}

// ---- head ----
// A week picker like Game Center's and Pick'em's (one tab stop, no "All weeks": it is inert on Lineup, spec passes allWeeks={false}); the strip scrolls inside its own box.
const chev = d => `<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="${d}" fill="currentColor"/></svg>`;
const sq = (aria, d) => `<button type="button" tabindex="-1" aria-label="${aria}" style="flex: none; width: 44px; height: 44px; padding: 0; display: grid; place-items: center; box-sizing: border-box; border-radius: 0; background: transparent; border: 2px solid {{t.ink}}; color: {{t.ink}}">${chev(d)}</button>`;
function weekPicker({ week = 7, phone = false } = {}) {
  const segs = Array.from({ length: 18 - (week - 2) + 1 }, (_, i) => i + week - 2).map((w, i) => { const on = w === week; return `<button type="button" role="radio" aria-checked="${on}" tabindex="${on ? 0 : -1}" style="flex: none; min-height: 44px; display: inline-flex; align-items: center; gap: 8px; padding: 0 14px; box-sizing: border-box; border-radius: 0; font-family: inherit; font-size: 15px; font-weight: 600; border: 2px solid ${on ? '{{t.play}}' : '{{t.ink}}'}; ${i ? 'margin-left: -2px; ' : ''}background: ${on ? '{{t.play}}' : 'transparent'}; color: ${on ? '{{t.playInk}}' : '{{t.ink}}'}">${on ? arrow() : ''}Wk ${w}</button>`; }).join('');
  return `<div role="group" aria-label="Week picker" style="display: flex; align-items: center; gap: ${phone ? 8 : 12}px; min-width: 0; ${phone ? 'width: 100%' : ''}">${sq('Previous week', 'M7 1h2v10H7zM5 3h2v6H5zM3 5h2v2H3z')}<div role="radiogroup" aria-label="Week" style="display: flex; flex: 1 1 0; min-width: 0; ${phone ? '' : 'flex: none; width: 336px; '}overflow-x: auto; padding: 2px">${segs}</div>${sq('Next week', 'M3 1h2v10H3zM5 3h2v6H5zM7 5h2v2H7z')}</div>`;
}
function head({ live = false, phone = false, bestBall = false } = {}) {
  const chips = `${bestBall ? k.rowTag('Best ball') : ''}${live ? k.liveChip('Live') : ''}`;
  const title = `<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px ${phone ? 12 : 16}px">${avatar('Darkness Falls', { size: phone ? 40 : 48 })}${k.h1('Darkness Falls', { phone })}${chips}</div>`;
  if (phone) return `<section aria-labelledby="h1" style="display: flex; flex-direction: column; gap: 10px; min-width: 0"><div style="font-size: 14px; font-weight: 600; color: {{t.dim}}">Lineup · ${LG}</div>${title}<p style="margin: 0; font-size: 15px; color: {{t.dim}}">Times in CDT</p>${weekPicker({ phone })}</section>`;
  return `<section aria-labelledby="h1" style="display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 16px 24px"><div style="display: flex; flex-direction: column; gap: 12px; min-width: 0"><div style="font-size: 15px; font-weight: 600; color: {{t.dim}}">Lineup · ${LG}</div>${title}<p style="margin: 0; font-size: 17px; color: {{t.dim}}">Times in CDT</p></div>${weekPicker()}</section>`;
}

// ---- phone footer: one bottom-pinned container, move strip over the three section toggles (exclusive: Starters, Bench or Outlook) ----
// Only the sentence is the polite live region; Cancel sits outside it and carries aria-keyshortcuts="Escape".
const moveStrip = name => `<div style="display: flex; align-items: center; justify-content: space-between; gap: 12px"><span role="status" style="font-size: 14px; font-weight: 600">Moving ${name}. Pick a highlighted player.</span>${k.btnGhost('Cancel').replace('<button ', '<button aria-keyshortcuts="Escape" ')}</div>`;
const tog = (label, count, on, aria) => `<button type="button" aria-pressed="${on}" aria-label="${aria}" style="flex: 1; min-height: 44px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 0 8px; box-sizing: border-box; border-radius: 0; font-family: inherit; font-size: 14px; font-weight: 600; border: 2px solid ${on ? '{{t.play}}' : '{{t.ink}}'}; background: ${on ? '{{t.play}}' : 'transparent'}; color: ${on ? '{{t.playInk}}' : '{{t.ink}}'}">${on ? arrow() : ''}${label}${count ? ` <span style="font-weight: 400">${count}</span>` : ''}</button>`;
function phoneFooter({ view = 'starters', moving = '', sticky = true } = {}) {
  const toggles = `<div role="group" aria-label="Lineup section" data-testid="lineup-mobile-tabs" style="display: flex; gap: 8px">${tog('Starters', '8/9', view === 'starters', 'Starters, 8 of 9 filled')}${tog('Bench', '6', view === 'bench', 'Bench, 6 players')}${tog('Outlook', '', view === 'outlook', 'Outlook')}</div>`;
  return `<div data-testid="lineup-sticky-footer" style="${sticky ? 'position: sticky; bottom: 0; z-index: 5; ' : ''}box-sizing: border-box; background: {{t.panel}}; border-top: 6px double {{t.frame}}; padding: 10px 16px 12px; display: flex; flex-direction: column; gap: 10px">${moving ? moveStrip(moving) : ''}${toggles}</div>`;
}

// ---- state specimens ----
const spec = (label, html, { span = false, id } = {}) => `<section${id ? ` aria-labelledby="${id}"` : ''} style="display: flex; flex-direction: column; gap: 8px; min-width: 0; ${span ? 'grid-column: 1 / -1' : ''}"><h3${id ? ` id="${id}"` : ''} style="margin: 0; font-size: 13px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: {{t.dim}}">${label}</h3>${html}</section>`;
const msgCard = (text, btn, testId) => `<div data-testid="${testId}" style="${FRAME2}; padding: 20px; display: flex; flex-direction: column; align-items: flex-start; gap: 14px; box-sizing: border-box"><p style="margin: 0; font-size: 16px; text-wrap: pretty">${text}</p>${btn}</div>`;
// 2px Danger edge and the alert pictogram; the ghost Retry sits outside the alert text.
const alertRow = (text, testId) => `<div data-testid="${testId}" style="border: 2px solid {{t.danger}}; background: {{t.panel}}; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 8px 8px 8px 16px; box-sizing: border-box; font-size: 15px"><span role="alert" style="flex: 1 1 260px; display: flex; align-items: flex-start; gap: 10px; min-width: 0">${warn('{{t.danger}}')}<span style="text-wrap: pretty">${text}</span></span>${k.btnGhost('Retry')}</div>`;
const skel = k.skel;
// Toast: the message is the polite live region, the Undo button sits outside it.
const toast = (msg, { undo = false } = {}) => `<div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 56px; box-sizing: border-box; padding: 6px 8px 6px 16px; background: {{t.panel}}; border: 2px solid {{t.ink}}; font-size: 15px"><span role="status" style="text-wrap: pretty">${msg}</span>${undo ? k.btnGhost('Undo') : ''}</div>`;
const danger = t => `<span style="color: {{t.danger}}">${t}</span>`;
// Drop confirmation: the title carries a player name, so it is Archivo 700, not pixel type. Cancel holds the default focus; the destructive Drop is a ghost with Danger text.
const dropDialog = ({ name, body, actions }) => `<div style="position: absolute; inset: 0; z-index: 10; display: grid; place-items: center; padding: 24px; box-sizing: border-box; background: {{t.scrim}}"><div role="dialog" aria-modal="true" aria-labelledby="drop-t" style="${FRAME}; width: 100%; max-width: 480px; box-sizing: border-box"><div style="padding: 14px 20px; border-bottom: 2px solid {{t.rule}}"><h2 id="drop-t" style="margin: 0; font-size: 20px; font-weight: 700">Drop ${name}?</h2></div><div style="padding: 20px; font-size: 16px">${body}</div><div style="display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 12px; padding: 14px 20px; border-top: 2px solid {{t.rule}}">${actions}</div></div></div>`;
// Called shot (Your called shot): the pair, the numbers as called, one status sentence. Hit, Miss and Void are outlined result chips; Live is the one green.
// Each state is drawn at a clock where it can be true, and its figures agree with the fixture:
//  open   9:10 AM  Marks (Proj 11.8) over Spears (Proj 12.9): both games are Sun 12:00 PM and unstarted; the Forecast leans to the higher projection, Spears, 56%.
//  locked 2:40 PM  McBride (Sun 3:25 PM, Proj 8.9) over Kincaid (Sun 12:00 PM, live): one game has started; Kincaid is the lower projection, so the lean to him is 42%.
//  live   2:40 PM  Marks 9.1 (Q4 1:48) to Spears 13.4 (Q4 0:48), the LineupLive rows.
//  hit, miss, void: a settled week (Wk 6) and other players (Chase over Addison), so no figure contradicts this week's live points.
const SHOTS = {
  open: { when: '9:10 AM', pair: 'Woody Marks over Tyjae Spears', nums: 'Proj 11.8 vs 12.9 · 56% lean to Tyjae Spears', status: 'Open until the first of the two kicks off', withdraw: true },
  locked: { when: '2:40 PM', pair: 'Trey McBride over Dalton Kincaid', nums: 'Proj 8.9 vs 7.4 · 42% lean to Dalton Kincaid', status: 'Locked: one of the two games has started', chip: () => k.chip(`<span style="display: inline-flex; align-items: center; gap: 8px">${lockIcon()}Locked</span>`) },
  live: { when: '2:40 PM', pair: 'Woody Marks over Tyjae Spears', nums: 'Proj 11.8 vs 12.9 · 56% lean to Tyjae Spears', status: 'Live: Woody Marks 9.1 to Tyjae Spears 13.4', chip: () => k.liveChip('Live') },
  hit: { when: 'Wk 6', pair: "Ja'Marr Chase over Jordan Addison", nums: 'Proj 16.4 vs 10.5 · 35% lean to Jordan Addison', status: "Hit: Ja'Marr Chase scored 18.2, Jordan Addison 7.4", chip: () => k.chip('Hit') },
  miss: { when: 'Wk 6', pair: "Ja'Marr Chase over Jordan Addison", nums: 'Proj 16.4 vs 10.5 · 35% lean to Jordan Addison', status: "Miss: Ja'Marr Chase scored 6.3, Jordan Addison 12.6", chip: () => k.chip('Miss') },
  void: { when: 'Wk 6', pair: "Ja'Marr Chase over Jordan Addison", nums: 'Proj 16.4 vs 10.5 · 35% lean to Jordan Addison', status: 'Void: a player did not play, or the lineup changed', chip: () => k.chip('Void') },
};
const calledShotWhen = state => SHOTS[state].when;
function calledShot(state) {
  const S = SHOTS[state];
  return `<div role="group" aria-label="Your called shot" data-testid="called-shot-line" data-state="${state}" style="border: 2px solid {{t.rule}}; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; box-sizing: border-box"><div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px"><span style="font-size: 13px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: {{t.dim}}">Your called shot</span><span style="margin-left: auto">${S.chip ? S.chip() : ''}</span></div><div style="font-size: 15px; font-weight: 600">${S.pair}</div><div style="font-size: 13px; color: {{t.dim}}">${S.nums}</div><div style="font-size: 14px">${S.status}</div>${S.withdraw ? `<div>${k.btnGhost('Withdraw', { aria: 'Withdraw your called shot: ' + S.pair })}</div>` : ''}</div>`;
}
// Quick pick for the empty FLEX: every lineup entry (server order: position, then name) that is not already in FLEX and that moveLegality allows into it (not locked, not spent, eligibleSlots includes FLEX: RB, WR, TE). Label: "{name} · {pos} · Bench|IR|Starting {slot}" (QuickPickMenu.jsx:23).
function quickPickFlex(clock = 9) {
  const starters = D0.STARTERS.filter(e => !e.empty), grp = e => starters.findIndex(x => baseOf(x.slot) === baseOf(e.slot));
  const ordered = [...[...starters].sort((a, b) => grp(a) - grp(b) || a.name.localeCompare(b.name)), ...BY_POS_NAME.filter(e => e.slot === 'BENCH'), ...BY_POS_NAME.filter(e => e.slot === 'IR')];
  const items = ordered.filter(e => slotFits('FLEX', posOf(e)) && e.slot !== 'FLEX').filter(e => clock === 9 || !rowModel(e, clock, D0.STARTERS.indexOf(e)).locked).map(e => ({ label: `${e.name} · ${posOf(e)} · ${e.slot === 'BENCH' ? 'Bench' : e.slot === 'IR' ? 'IR' : 'Starting ' + baseOf(e.slot)}` }));
  return items;
}

module.exports = { ...k, FRAME2, LG, EMPTY_SLOT, rowModel, teamOf, ledgerRow, ledgerFrame, startersFrame, irFrame, benchFrame, summaryStrip, forecastPanel, forecastStats, leanLine, suggestionCard, byeClusters, CLUSTERS, WORST, worstLine, matchupPreview, weekPicker, head, phoneFooter, moveStrip, glueDots, spec, msgCard, alertRow, skel, toast, danger, dropDialog, calledShot, calledShotWhen, quickPickFlex, injCode, wordTag, attn, detailOf, labelOf, edgeOf };
