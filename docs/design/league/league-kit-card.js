// Player card (Decision card) pieces for the PlayerCard board. Requires the samples kit and re-exports it plus the card pieces.
// Product truth: E:/ee-ps-w3-read src/widgets/player-decision-card/ui/PlayerDecisionCard.jsx and its entities/features. Only the look changes.
const k = require('./league-kit-samples');
const W7 = require('./week7-games');
const { px, SR, FRAME, FRAME2, esc, posTag, injTag, arrow, warn, btnGhost, btnFill, menuButton, frameHead, avatar, skel, iconBtn } = k;

const f1 = n => Number(n).toFixed(1);

// ---- fixture: Puka Nacua, 2026 weeks 1-6 (PPR: 1 per catch, 0.1 per yard, 6 per TD). Every figure on the card derives from this table. ----
const LOG = [
  { week: 1, opp: 'ARI', rushYds: 0, rec: 8, recYds: 109, recTD: 1, tgt: 11, car: 0, air: 96, snaps: 61, share: 0.92, tgtShare: 0.33 },
  { week: 2, opp: 'SF', rushYds: 0, rec: 7, recYds: 88, recTD: 0, tgt: 10, car: 0, air: 81, snaps: 58, share: 0.88, tgtShare: 0.29 },
  { week: 3, opp: 'SEA', rushYds: 0, rec: 10, recYds: 131, recTD: 1, tgt: 13, car: 0, air: 124, snaps: 64, share: 0.94, tgtShare: 0.36 },
  { week: 4, opp: 'IND', rushYds: 0, rec: 6, recYds: 74, recTD: 0, tgt: 8, car: 0, air: 63, snaps: 59, share: 0.89, tgtShare: 0.24 },
  { week: 5, opp: 'PHI', rushYds: 8, rec: 9, recYds: 98, recTD: 0, tgt: 11, car: 1, air: 88, snaps: 60, share: 0.91, tgtShare: 0.31 },
  { week: 6, opp: 'DAL', rushYds: 0, rec: 8, recYds: 102, recTD: 1, tgt: 10, car: 0, air: 92, snaps: 62, share: 0.93, tgtShare: 0.30 },
].map(r => ({ ...r, pts: r.rec + r.recYds * 0.1 + r.recTD * 6 + r.rushYds * 0.1 }));
const sum = (a, f) => a.reduce((s, r) => s + f(r), 0);
const AVG = f => sum(LOG, f) / LOG.length;
const SEASON_PTS = sum(LOG, r => r.pts);
// The game log's stat line is the product's statLine(): STAT_ORDER and STAT_LABELS, zero stats dropped.
const statLine = r => [[r.rushYds, 'Rush Yds'], [r.rec, 'Rec'], [r.recYds, 'Rec Yds'], [r.recTD, 'Rec TD']].filter(([v]) => v).map(([v, l]) => `${v} ${l}`).join(', ') || '-';
// Weekly bars: weeks 1-6 actual, week 7 Unavailable (out), week 8 bye (LAR), weeks 9-18 projected.
const PROJ_AFTER = [19.1, 18.8, 19.4, 18.6, 19.0, 18.2, 19.3, 18.9, 18.5, 19.0];
const WEEKS = [
  ...LOG.map(r => ({ week: r.week, kind: 'actual', pts: r.pts })),
  { week: 7, kind: 'unavailable', reason: 'out' },
  { week: 8, kind: 'bye' },
  ...PROJ_AFTER.map((p, i) => ({ week: 9 + i, kind: 'projected', pts: p })),
];
const ROS = PROJ_AFTER.reduce((s, p) => s + p, 0);
const PUKA = {
  name: 'Puka Nacua', pos: 'WR', team: 'LAR', inj: 'O', slot: 'WR', game: W7.byKey('JAX', 'LAR'),
  seasons: [
    { season: 2026, g: LOG.length, ppg: SEASON_PTS / LOG.length, pts: SEASON_PTS, rank: null, adp: '7.4' },
    { season: 2025, g: 17, ppg: 316.4 / 17, pts: 316.4, rank: '6 of 88', adp: '9.4' },
    { season: 2024, g: 15, ppg: 258 / 15, pts: 258, rank: '12 of 91', adp: '38.6' },
  ],
};

// ---- small parts ----
// Section title: the card's own h3 (the player's name is the h2), Pixel 16 as every tertiary frame head.
const h3s = (id, text) => `<h3 id="${id}" style="margin: 0; ${px(16)}">${text}</h3>`;
// A tertiary section frame. body is padded 14/20 unless pad is false (tables run edge to edge).
const sec = ({ id, title, body, pad = true }) => `<section aria-labelledby="${id}" style="${FRAME2}; min-width: 0">${frameHead(h3s(id, title))}${pad ? `<div style="padding: 14px 20px 16px; display: flex; flex-direction: column; gap: 8px">${body}</div>` : body}</section>`;
const dimLine = (t, extra = '') => `<p style="margin: 0; font-size: 14px; color: {{t.dim}}; text-wrap: pretty; ${extra}">${t}</p>`;
const inkLine = t => `<p style="margin: 0; font-size: 15px">${t}</p>`;
// In-row badge (the product's Badge variant neutral): Archivo 13 700 uppercase, Rule edge.
const rowBadge = t => `<span style="display: inline-flex; align-items: center; box-sizing: border-box; height: 22px; padding: 0 6px; border: 2px solid {{t.rule}}; font-size: 13px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; line-height: 1; flex: none; white-space: nowrap">${t}</span>`;
// Tables: k.table, with 8px cell padding so the 7-column Usage table fits the 560 drawer.
const tbl = o => k.table(o).replace(/padding: 0 12px/g, 'padding: 0 8px');
const chev = dir => `<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" shape-rendering="crispEdges" style="flex: none"><path d="${dir === 'prev' ? 'M7 1h2v2H7zM5 3h2v2H5zM3 5h2v2H3zM5 7h2v2H5zM7 9h2v2H7z' : 'M3 1h2v2H3zM5 3h2v2H5zM7 5h2v2H7zM5 7h2v2H5zM3 9h2v2H3z'}" fill="currentColor"/></svg>`;
const navBtn = dir => `<button type="button" aria-label="${dir === 'prev' ? 'Previous player' : 'Next player'}" style="width: 44px; height: 44px; padding: 0; display: grid; place-items: center; flex: none; box-sizing: border-box; border-radius: 0; background: transparent; border: 2px solid transparent; color: {{t.ink}}">${chev(dir)}</button>`;
const INJ = { Q: 'Questionable', D: 'Doubtful', O: 'Out', IR: 'Injured reserve' };
// Injury tag as the product prints it: the code (O, Q, D, IR) with the status for screen readers. Out is the inverted Ink tag.
const injCode = code => `<span style="display: inline-grid; place-items: center; min-width: 24px; height: 24px; padding: 0 ${code === 'IR' ? 6 : 0}px; box-sizing: border-box; border: 2px solid {{t.ink}}; ${code === 'O' ? 'background: {{t.ink}}; color: {{t.panel}}; ' : ''}font-size: 13px; font-weight: 700; letter-spacing: .04em; line-height: 1; flex: none"><span aria-hidden="true">${code}</span><span style="${SR}">Injury status: ${INJ[code]}</span></span>`;
const closeBtn = () => iconBtn('x', 'Close', { size: 44, quiet: true });

// ---- header: avatar, name (Archivo 24 700), badges; prev/next and close on the right ----
// nav: { n, total } (waivers passes playerIds); phone puts the controls on their own row above the name.
function cardHeader({ id, name, pos, inj, badges = [], team, locked = false, nav, phone = false }) {
  const controls = `<div style="display: flex; align-items: center; flex: none">${nav ? `<span role="status" aria-label="Player ${nav.n} of ${nav.total}" style="font-size: 14px; color: {{t.dim}}; white-space: nowrap; padding: 0 6px">${nav.n} of ${nav.total}</span>${navBtn('prev')}${navBtn('next')}` : ''}${closeBtn()}</div>`;
  const ident = `<div style="display: flex; align-items: center; gap: 14px; min-width: 0">${avatar(name, { size: 56 })}<div style="min-width: 0"><h2 id="${id}" tabindex="-1" style="margin: 0; font-size: 24px; line-height: 1.2; font-weight: 700; ${phone ? '' : 'white-space: nowrap; overflow: hidden; text-overflow: ellipsis'}">${name}</h2><div style="display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; margin-top: 6px">${pos ? posTag(pos) : ''}${inj ? injCode(inj) : ''}${badges.map(rowBadge).join('')}${team ? `<span style="font-size: 13px; color: {{t.dim}}">${team}</span>` : ''}${locked ? '<span style="font-size: 13px; font-weight: 700; color: {{t.dim}}">Locked</span>' : ''}</div></div></div>`;
  return phone
    ? `<div style="padding: 0 8px 12px 16px"><div style="display: flex; align-items: center; justify-content: flex-end">${controls}</div>${ident}</div>`
    : `<div style="padding: 12px 8px 12px 20px; display: flex; align-items: flex-start; justify-content: space-between; gap: 8px">${ident}${controls}</div>`;
}

// ---- action rows ----
// Watch: a toggle (aria-pressed). Pressed = the Play-blue selected state, never the green filled action.
const watchBtn = (on = false) => `<button type="button" aria-pressed="${on}" style="min-height: 44px; display: inline-flex; align-items: center; gap: 8px; padding: 0 16px; box-sizing: border-box; border-radius: 0; font-family: inherit; font-size: 15px; font-weight: 600; background: ${on ? '{{t.play}}' : 'transparent'}; color: ${on ? '{{t.playInk}}' : '{{t.ink}}'}; border: 2px solid ${on ? '{{t.play}}' : '{{t.ink}}'}">${on ? arrow() : ''}${on ? 'Watching' : 'Watch'}</button>`;
const actionRow = inner => `<div role="group" aria-label="Player actions" style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 0 20px 16px">${inner}</div>`;
// my_team, lineup-managed: Bench (a starter) or Start, Compare menu, Trade link, Drop, then Watch. All ghost; the drawer carries no filled action.
const lineupActions = ({ starting = true } = {}) => actionRow(`${btnGhost(starting ? 'Bench' : 'Start')}${menuButton('Compare')}${btnGhost('Trade', { tag: 'a', aria: 'Trade, opens Trade Center' })}${btnGhost('Drop')}${watchBtn(false)}`);
// rostered: Propose trade link, then who holds him.
const rosteredActions = team => actionRow(`${btnGhost('Propose trade', { tag: 'a', aria: 'Propose trade, opens Trade Center' })}<span style="font-size: 14px; color: {{t.dim}}">Rostered by ${team}</span>${watchBtn(true)}`);
// waivers: the claim bar (drop pick, FAAB bid, Claim). filled: the phone sheet is modal, so its Claim is the one filled action; the desktop drawer draws it ghost.
function claimBar({ name, drop, bid, remaining, priority, filled = true, capacity = false, drops, id = 'cl' }) {
  const roster = drops.map(d => `${d.name} (${d.pos})`);
  const label = capacity ? 'Drop a player' : 'Drop a player (optional)';
  const claim = filled ? btnFill('Claim', { tag: 'button', aria: `Claim ${name}` }) : btnGhost('Claim', { aria: `Claim ${name}` });
  const note = capacity ? `<p id="${id}-cap" style="margin: 0; font-size: 14px; color: {{t.dim}}">Your roster is full. Choose a player to drop when this claim clears.</p>` : '';
  // one surface for both controls: the Panel the sheet sits on (the kit's Field fill read as two shades on the light Panel)
  const one = h => h.split('background: {{t.bg}}').join('background: {{t.panel}}');
  return one(`<div role="group" aria-label="Claim ${esc(name)}" style="display: flex; flex-direction: column; gap: 14px; padding: 0 16px 16px">${note}
${k.select({ id: id + '-drop', label, options: [{ value: '', label: capacity ? 'Choose a player to drop' : 'No drop' }, ...roster.map(r => ({ value: r, label: r }))], value: drop })}
${k.field({ id: id + '-bid', label: 'Bid', value: bid, type: 'number', hint: `$${remaining} remaining` })}
<div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap">${claim}<span style="font-size: 14px; color: {{t.dim}}">Priority #${priority}</span></div>
</div>`);
}

// ---- sections ----
function injurySection({ id, view, detail, practice }) {
  return sec({ id, title: 'Injury', body: `${view ? inkLine(view) : ''}${detail ? dimLine(detail) : ''}${practice ? dimLine(`Practice: ${practice}`) : ''}` });
}
function gameSection({ id, opp, kickoff, line, weather }) {
  const implied = f1((Number(line.total) - line.spread) / 2);
  return sec({ id, title: 'Game', body: `${inkLine(`vs ${opp} · ${kickoff}`)}${dimLine(`Line: ${line.spread} / ${line.total} · Implied team total: ${implied}`)}${dimLine(weather)}` });
}
function projectionSection({ id, floor, proj, ceil, volatility }) {
  const bar = k.rangeBar({ floor, proj, ceil });
  return sec({ id, title: 'Weekly projection', body: volatility ? `<div style="display: flex; align-items: center; gap: 12px"><div style="flex: 1; min-width: 0">${bar}</div>${rowBadge(volatility)}</div>` : bar });
}
// Usage: the last three played weeks and the season average (rounded to one decimal here; the product prints the raw average), then the opponent-rank line.
function usageSection({ id, table = true, opps = 'Opp rank vs WR: W7 JAX 18th, W9 SEA 11th' }) {
  const last3 = LOG.slice(-3);
  const snaps = (n, s) => `${n}${s != null ? ` (${Math.round(s * 100)}%)` : ''}`;
  const rows = last3.map(r => [`Wk ${r.week}`, r.tgt, r.car, r.air, snaps(r.snaps, r.share), `${Math.round(r.tgtShare * 100)}%`, f1(r.pts)]);
  rows.push(['Season avg', f1(AVG(r => r.tgt)), f1(AVG(r => r.car)), f1(AVG(r => r.air)), snaps(f1(AVG(r => r.snaps)), AVG(r => r.share)), `${Math.round(AVG(r => r.tgtShare) * 100)}%`, f1(AVG(r => r.pts))]);
  const cols = [{ label: 'Week' }, { label: 'Tgt', align: 'right' }, { label: 'Car', align: 'right' }, { label: 'Air yds', align: 'right' }, { label: 'Snaps', align: 'right' }, { label: 'Tgt share', align: 'right' }, { label: 'FPTS', align: 'right' }];
  return sec({ id, title: 'Usage', pad: false, body: `${table ? tbl({ label: 'Usage', cols, rows, minW: 480 }) : ''}<p style="margin: 0; padding: 12px 20px 14px; font-size: 14px; color: {{t.dim}}${table ? '; border-top: 2px solid {{t.rule}}' : ''}">${opps}</p>` });
}
const tile = (label, value, sub = '') => `<div><div style="font-size: 13px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: {{t.dim}}">${label}</div><div style="font-size: 17px; font-weight: 700; margin-top: 2px">${value}${sub ? ` <span style="font-size: 13px; font-weight: 400; color: {{t.dim}}">${sub}</span>` : ''}</div></div>`;
// Decision strip: a tile whose source is null is not drawn. For your own player the Upgrade tile is hidden; for a claim candidate it is an outlined Ink pill, not green.
function stripSection({ id, tiles }) {
  return sec({ id, title: 'Decision strip', body: `<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 16px; align-items: start">${tiles.join('')}</div>` });
}
function pukaStrip(id) {
  return stripSection({ id, tiles: [tile('Week 7 projection', 'out'), tile('Rest of season (thru Wk 18)', f1(ROS)), tile('Ownership', '99.2%', '+0.3 7d'), tile('Depth chart', 'WR1'), tile('Usage (season avg)', f1(AVG(r => r.pts)), 'FPTS/gm')] });
}
function seasonSection({ id }) {
  const dash = label => `<span aria-hidden="true">-</span><span style="${SR}">${label}</span>`;
  const rows = PUKA.seasons.map(s => [String(s.season), s.g, f1(s.ppg), f1(s.pts), s.rank || dash('no rank on record'), s.adp || dash('no ADP on record')]);
  const cols = [{ label: 'Season' }, { label: 'G', align: 'right' }, { label: 'FPTS/G', align: 'right' }, { label: 'Pts', align: 'right' }, { label: 'Pos rank', align: 'right' }, { label: 'ADP', align: 'right' }];
  return sec({ id, title: 'Season summary', pad: false, body: tbl({ label: 'Season summary', cols, rows, minW: 440 }) });
}
// Season pick: a radiogroup, selected = Play-blue fill + arrow (only with 2+ seasons on record).
const seasonPick = (seasons, on) => `<div role="radiogroup" aria-label="Season" style="display: inline-flex">${seasons.map((s, i) => `<button type="button" role="radio" aria-checked="${s === on}" style="min-height: 44px; display: inline-flex; align-items: center; gap: 8px; padding: 0 16px; box-sizing: border-box; border-radius: 0; font-family: inherit; font-size: 15px; font-weight: 600; border: 2px solid ${s === on ? '{{t.play}}' : '{{t.ink}}'}; ${i ? 'margin-left: -2px; ' : ''}background: ${s === on ? '{{t.play}}' : 'transparent'}; color: ${s === on ? '{{t.playInk}}' : '{{t.ink}}'}">${s === on ? arrow() : ''}${s}</button>`).join('')}</div>`;
// Eighteen-week bars: solid Ink = scored, outlined Dim = projected, dashed = bye, X = out (a bar-width mark). The current week's number is boxed; the dashed rule ends the fantasy season.
function weeklySection({ id, current = 7, seasonEnd = 17 }) {
  const H = 88, max = Math.max(...WEEKS.map(w => w.pts || 0));
  const cell = w => {
    const name = w.kind === 'bye' ? `Week ${w.week}: bye` : w.kind === 'unavailable' ? `Week ${w.week}: ${w.reason}` : `Week ${w.week}: ${f1(w.pts)} ${w.kind === 'actual' ? 'points' : 'projected'}`;
    const h = w.pts ? Math.max(6, Math.round(w.pts / max * H)) : 0;
    const bar = w.kind === 'actual' ? `<span style="display: block; height: ${h}px; background: {{t.ink}}"></span>`
      : w.kind === 'projected' ? `<span style="display: block; height: ${h}px; box-sizing: border-box; border: 2px solid {{t.dim}}"></span>`
      : w.kind === 'bye' ? `<span style="display: block; height: ${H}px; box-sizing: border-box; border: 2px dashed {{t.rule}}"></span>`
      : '<span style="display: grid; place-items: center; height: 22px; box-sizing: border-box; border: 2px solid {{t.ink}}"><svg width="8" height="8" viewBox="0 0 12 12" aria-hidden="true" shape-rendering="crispEdges"><path d="M1 1h2v2H1zM3 3h2v2H3zM5 5h2v2H5zM7 7h2v2H7zM9 9h2v2H9zM9 1h2v2H9zM7 3h2v2H7zM3 7h2v2H3zM1 9h2v2H1z" fill="currentColor"/></svg></span>';
    const cur = w.week === current;
    return `<div role="listitem" ${cur ? 'aria-current="true" ' : ''}aria-label="${name}${cur ? ', current week' : ''}" title="${name}" style="display: flex; flex-direction: column; gap: 6px; min-width: 0"><div style="height: ${H}px; display: flex; flex-direction: column; justify-content: flex-end">${bar}</div><span aria-hidden="true" style="text-align: center; font-size: 13px; line-height: 20px; box-sizing: border-box; ${cur ? 'border: 2px solid {{t.ink}}; font-weight: 700' : 'border: 2px solid transparent; color: {{t.dim}}'}">${w.week}</span></div>`;
  };
  const cols = WEEKS.map(w => cell(w) + (w.week === seasonEnd ? '<div aria-hidden="true" style="border-left: 2px dashed {{t.frame}}; margin: 0 2px; height: 114px"></div>' : '')).join('');
  const legend = `<p style="margin: 0; font-size: 13px; color: {{t.dim}}; display: flex; flex-wrap: wrap; gap: 4px 16px"><span>Solid: scored</span><span>Outlined: projected</span><span>Dashed box: bye</span><span>X: out</span><span>Dashed rule: end of Wk ${seasonEnd}</span></p>`;
  return sec({ id, title: 'Weekly points', body: `<div role="list" aria-label="Weekly points, actual and projected" tabindex="0" style="display: grid; grid-template-columns: repeat(${seasonEnd}, minmax(0, 1fr)) 6px minmax(0, 1fr); gap: 4px; align-items: end">${cols}</div>${legend}` });
}
function gameLogSection({ id }) {
  const cols = [{ label: 'Week' }, { label: 'Opponent' }, { label: 'Stat line' }, { label: 'FPTS', align: 'right' }];
  const rows = LOG.map(r => [`Wk ${r.week}`, r.opp, statLine(r), f1(r.pts)]);
  return sec({ id, title: 'Game log', pad: false, body: tbl({ label: 'Game log', cols, rows, minW: 440 }) });
}
// Bio has no producer yet (the card ships bio: null), so the product draws nothing; the board draws it to show where it lands, with a heading the product's bare tile lacks.
function bioSection({ id }) {
  const fields = [['Age', '25'], ['Height', '6 ft 2 in'], ['Weight', '206 lbs'], ['College', 'Washington'], ['Experience', '4 yrs'], ['Draft', '2023 Rd 5']];
  return sec({ id, title: 'Bio', body: `<dl style="margin: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px 12px">${fields.map(([l, v]) => `<div><dt style="font-size: 13px; color: {{t.dim}}">${l}</dt><dd style="margin: 0; font-size: 15px; font-weight: 600">${v}</dd></div>`).join('')}</dl>` });
}
function benchSection({ id, options }) {
  const li = (o, last) => `<li style="display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 6px 0; ${last ? '' : 'border-bottom: 2px solid {{t.rule}}'}"><span style="display: flex; align-items: center; gap: 10px; min-width: 0">${posTag(o.pos)}<span style="font-size: 15px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">${o.name}</span><span style="font-size: 14px; color: {{t.dim}}">${o.proj}</span></span>${btnGhost('Swap', { aria: `Swap in ${o.name}` })}</li>`;
  return sec({ id, title: 'Bench options', body: `<ul role="list" style="list-style: none; margin: 0; padding: 0">${options.map((o, i) => li(o, i === options.length - 1)).join('')}</ul>` });
}
function newsSection({ id, items }) {
  const li = (n, last) => `<li style="padding: 0 0 10px; ${last ? '' : 'border-bottom: 2px solid {{t.rule}}'}"><a href="#" style="display: inline-flex; align-items: center; min-height: 44px; font-size: 15px; font-weight: 600; color: {{t.ink}}; text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 4px; text-decoration-color: {{t.dim}}">${n.headline}</a><span style="${SR}">, opens in a new tab</span>${n.blurb ? `<p style="margin: 4px 0 0; font-size: 14px; color: {{t.dim}}; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden">${n.blurb}</p>` : ''}<p style="margin: 4px 0 0; font-size: 13px; color: {{t.dim}}">${n.date}</p></li>`;
  return sec({ id, title: 'News', body: `<ul role="list" style="list-style: none; margin: 0; padding: 0">${items.map((n, i) => li(n, i === items.length - 1)).join('')}</ul>` });
}

// ---- containers ----
// The drawer: a primary frame (6px double Frame). Sections stack in 16px gaps under the header and action row.
const drawer = ({ label, header, actions = '', sections = [], busy = false, width = 560 }) => `<div role="dialog" aria-modal="true" aria-label="${esc(label)}"${busy ? ' aria-busy="true"' : ''} style="${FRAME}; width: ${width}px; max-width: 100%; box-sizing: border-box; display: flex; flex-direction: column">${header}${actions}${sections.length ? `<div style="padding: 0 16px 16px; display: flex; flex-direction: column; gap: 16px">${sections.join('')}</div>` : ''}</div>`;
// The phone bottom sheet inside a 390x844 screen: the page behind sits under the scrim, the sheet is 88vh with a square top edge and a square drag handle.
function phoneSheet({ label, header, actions, sections, behind }) {
  const sheetH = Math.round(844 * 0.88);
  return `<div style="position: relative; width: 390px; height: 844px; overflow: hidden; box-sizing: border-box; border: 2px solid {{t.rule}}; background: {{t.bg}}">
<div aria-hidden="true" style="padding: 20px 16px; display: flex; flex-direction: column; gap: 10px">${behind}</div>
<div aria-hidden="true" style="position: absolute; inset: 0; background: {{t.scrim}}"></div>
<div role="dialog" aria-modal="true" aria-label="${esc(label)}" style="position: absolute; left: 0; right: 0; bottom: 0; height: ${sheetH}px; box-sizing: border-box; overflow: hidden; background: {{t.panel}}; border: 6px double {{t.frame}}; border-bottom: 0">
<div aria-hidden="true" style="width: 40px; height: 4px; background: {{t.rule}}; margin: 8px auto 4px"></div>
${header}${actions}<div style="padding: 0 12px 16px; display: flex; flex-direction: column; gap: 16px">${sections.join('')}</div>
</div></div>`;
}
const alertBox = text => `<div role="alert" style="display: flex; align-items: center; gap: 10px; margin: 0 20px 20px; padding: 12px 14px; border: 2px solid {{t.danger}}; font-size: 16px">${warn('{{t.danger}}')}<span>${text}</span></div>`;
const loadingBody = () => `<span role="status" style="${SR}">Loading player details</span><div aria-hidden="true" style="padding: 0 16px 16px; display: flex; flex-direction: column; gap: 16px"><div style="display: flex; gap: 8px">${[88, 120, 80].map(w => skel(w + 'px', 44)).join('')}</div>${[0, 1].map(() => `<div style="${FRAME2}"><div style="padding: 14px 20px; border-bottom: 2px solid {{t.rule}}">${skel('140px', 16)}</div><div style="padding: 14px 20px 16px; display: flex; flex-direction: column; gap: 10px">${skel('92%', 16)}${skel('64%', 16)}${skel('78%', 16)}</div></div>`).join('')}</div>`;

module.exports = {
  ...k, PUKA, LOG, WEEKS, ROS, h3s, sec, rowBadge, tbl, cardHeader, watchBtn, lineupActions, rosteredActions, claimBar, injurySection, gameSection, projectionSection, usageSection,
  tile, stripSection, pukaStrip, seasonSection, seasonPick, weeklySection, gameLogSection, bioSection, benchSection, newsSection, drawer, phoneSheet, alertBox, loadingBody,
};
