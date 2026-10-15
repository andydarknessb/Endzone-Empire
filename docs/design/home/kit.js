// Tecmo play-select kit for the Home canvas. Every board is built from these functions so components never drift.
// Output is .dc.html markup with {{t.x}} tokens; the canvas resolves them per theme.
const fs = require('fs');
const path = require('path');

const PX = "'Press Start 2P', ui-monospace, monospace";
const BODY = "Archivo, 'Helvetica Neue', Arial, sans-serif";

const TOKENS = {
  dark: { bg: '#07080f', panel: '#10131f', frame: '#c8d0ff', rule: '#3a4170', ink: '#f4f4f8', dim: '#a8adc8', play: '#1830b8', playField: '#0f2190', playInk: '#ffffff', playDim: '#c8d0ff', playAccent: '#2fd97b', onPlayAccent: '#07080f', accent: '#2fd97b', onAccent: '#07080f', cursor: '#f8d030', danger: '#ff5a4a', onDanger: '#07080f', board: '#000000', boardInk: '#ffffff', boardDim: '#a8adc8', boardRule: '#3a4170', skel: '#2a3052' },
  light: { bg: '#eceef8', panel: '#ffffff', frame: '#1830b8', rule: '#b4bce0', ink: '#0c0e1c', dim: '#4a5070', play: '#1830b8', playField: '#0f2190', playInk: '#ffffff', playDim: '#c8d0ff', playAccent: '#2fd97b', onPlayAccent: '#07080f', accent: '#0f6a41', onAccent: '#ffffff', cursor: '#a86e00', danger: '#c62828', onDanger: '#ffffff', board: '#000000', boardInk: '#ffffff', boardDim: '#a8adc8', boardRule: '#3a4170', skel: '#dde1f0' },
};

const esc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const SR = 'position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap';

// ---- type ----
const snap = size => Math.max(16, Math.round(size / 8) * 8);
const px = (size, color = 'inherit') => `font-family: ${PX}; font-size: ${snap(size)}px; line-height: 1.5; font-weight: 400; text-transform: uppercase; color: ${color}`;
const h1 = (text, { phone } = {}) => `<h1 id="h1" style="margin: 0; ${px(phone ? 24 : 32)}; line-height: 1.3; overflow-wrap: break-word">${text}</h1>`;
const h2 = (id, text, { phone } = {}) => `<h2 id="${id}" style="margin: 0; ${px(phone ? 16 : 24)}">${text}</h2>`;
const meta = (text, extra = '') => `<span style="font-size: 13px; color: {{t.dim}}; ${extra}">${text}</span>`;

// ---- icons (authored SVG, 8px-grid, square caps) ----
const arrow = (color = 'currentColor') => `<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" style="flex: none"><path d="M3 1h2v2h2v2h2v2H7v2H5v2H3z" fill="${color}"/></svg>`;
const clock = color => `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style="flex: none"><path d="M5 1h6v2H5zM3 3h2v2H3zM11 3h2v2h-2zM1 5h2v6H1zM13 5h2v6h-2zM3 11h2v2H3zM11 11h2v2h-2zM5 13h6v2H5zM7 4h2v5H7zM9 8h2v2H9z" fill="${color}"/></svg>`;
const warn = color => `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style="flex: none"><path d="M7 1h2v2h2v4h2v4h2v4H1v-4h2V7h2V3h2zM7 5v5h2V5zM7 11v2h2v-2z" fill="${color}" fill-rule="evenodd"/></svg>`;
// Pixel sprites on a 2px grid (viewBox 96x48): Os, Xs, routes and arrowheads are stepped rects, like the clock and warn icons.
const cells = (x0, y0, rows) => rows.map((r, j) => [...r].map((c, i) => c === '#' ? 'M' + (x0 + i * 2) + ' ' + (y0 + j * 2) + 'h2v2h-2z' : '').join('')).join('');
const O = (x, y) => cells(x - 6, y - 6, ['.####.', '#....#', '#....#', '#....#', '#....#', '.####.']);
const X = (x, y) => cells(x - 5, y - 5, ['#...#', '.#.#.', '..#..', '.#.#.', '#...#']);
const H = (x1, x2, y) => 'M' + x1 + ' ' + y + 'h' + (x2 - x1) + 'v2h' + (x1 - x2) + 'z';
const V = (x, y1, y2) => 'M' + x + ' ' + y1 + 'h2v' + (y2 - y1) + 'h-2z';
const dashH = (x1, x2, y) => { let d = ''; for (let x = x1; x < x2; x += 8) d += H(x, Math.min(x + 4, x2), y); return d; };
const dashV = (x, y1, y2) => { let d = ''; for (let y = y1; y < y2; y += 8) d += V(x, y, Math.min(y + 4, y2)); return d; };
const headR = (x, y) => cells(x, y - 6, ['#...', '##..', '###.', '####', '###.', '##..', '#...']);
const headL = (x, y) => cells(x - 8, y - 6, ['...#', '..##', '.###', '####', '.###', '..##', '...#']);
const bracket = (x1, y1, x2, y2) => H(x1, x1 + 6, y1) + V(x1, y1, y1 + 6) + H(x2 - 6, x2, y1) + V(x2 - 2, y1, y1 + 6) + H(x1, x1 + 6, y2 - 2) + V(x1, y2 - 6, y2) + H(x2 - 6, x2, y2 - 2) + V(x2 - 2, y2 - 6, y2);
const PICTO = {
  // the pick: your side bracketed, the line of scrimmage between, the other side in Xs
  picks: bracket(8, 10, 36, 38) + O(22, 24) + dashV(48, 4, 44) + X(66, 14) + X(76, 34) + X(86, 14),
  // a formation: five linemen on the line, the QB behind
  lineup: dashH(4, 92, 8) + [16, 32, 48, 64, 80].map(x => O(x, 22)).join('') + O(48, 38),
  // the snake: back and forth across the board
  draft: H(8, 84, 8) + V(82, 8, 24) + H(12, 84, 22) + V(12, 22, 38) + H(12, 78, 36) + headR(78, 37),
  // a claim: a route across the waiver line
  waivers: O(12, 24) + H(20, 78, 23) + dashV(52, 4, 44) + headR(78, 24),
  // a trade: two routes passing each other
  trade: O(12, 14) + H(20, 78, 13) + headR(78, 14) + O(84, 34) + H(18, 76, 33) + headL(18, 34),
  // a win: the trophy
  trophy: H(30, 66, 6) + V(30, 6, 22) + V(64, 6, 22) + H(30, 66, 20) + H(22, 30, 8) + V(22, 8, 16) + H(22, 30, 14) + H(66, 74, 8) + V(72, 8, 16) + H(66, 74, 14) + V(46, 22, 32) + H(38, 58, 32) + H(34, 62, 38) + V(34, 38, 42) + V(60, 38, 42) + H(34, 62, 40),
  // creating: a new huddle
  create: [[48, 8], [30, 14], [66, 14], [24, 30], [72, 30], [36, 40], [60, 40]].map(([x, y]) => O(x, y)).join('') + X(48, 26),
  // joining: a route into the huddle box
  join: O(12, 24) + H(20, 54, 23) + headR(54, 24) + H(66, 92, 8) + H(66, 92, 38) + V(66, 8, 40) + V(90, 8, 40),
};
const picto = (kind, w = 96, color = '{{t.playInk}}') => '<svg width="' + w + '" height="' + (w / 2) + '" viewBox="0 0 96 48" aria-hidden="true" shape-rendering="crispEdges" style="display: block"><path d="' + PICTO[kind] + '" fill="' + color + '"/></svg>';

// ---- frames ----
// The one frame: a double rule in one weight, square corners, panel fill.
const FRAME = 'border: 6px double {{t.frame}}; background: {{t.panel}}';
const frameHead = (inner, { phone } = {}) => `<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: ${phone ? '12px 14px' : '14px 20px'}; border-bottom: 2px solid {{t.rule}}">${inner}</div>`;
const badge = (n, noun) => `<span style="position: relative; display: inline-grid; place-items: center; min-width: 28px; height: 28px; padding: 0 6px; box-sizing: border-box; border: 2px solid {{t.ink}}; ${px(12)}"><span aria-hidden="true">${n}</span><span style="${SR}">${noun === 'plays' ? n + (n === 1 ? ' thing needs' : ' things need') + ' you' : n + ' ' + noun}</span></span>`;

// ---- buttons and links ----
const BTN = 'min-height: 44px; display: inline-flex; align-items: center; justify-content: center; gap: 10px; padding: 0 16px; box-sizing: border-box; border-radius: 0; font-family: inherit; font-size: 15px; font-weight: 600; text-decoration: none; cursor: pointer';
const btnFill = (label, { href = '#', aria, tag = 'a' } = {}) => tag === 'a'
  ? `<a href="${href}"${aria ? ` aria-label="${esc(aria)}"` : ''} style="${BTN}; background: {{t.accent}}; border: 2px solid {{t.accent}}; color: {{t.onAccent}}">${label}${arrow()}</a>`
  : `<button type="button"${aria ? ` aria-label="${esc(aria)}"` : ''} style="${BTN}; background: {{t.accent}}; border: 2px solid {{t.accent}}; color: {{t.onAccent}}">${label}</button>`;
const btnGhost = (label, { href = '#', aria, tag = 'button' } = {}) => tag === 'a'
  ? `<a href="${href}"${aria ? ` aria-label="${esc(aria)}"` : ''} style="${BTN}; background: transparent; border: 2px solid {{t.ink}}; color: {{t.ink}}">${label}</a>`
  : `<button type="button"${aria ? ` aria-label="${esc(aria)}"` : ''} style="${BTN}; background: transparent; border: 2px solid {{t.ink}}; color: {{t.ink}}">${label}</button>`;
const btnQuiet = (label, { aria } = {}) => `<button type="button"${aria ? ` aria-label="${esc(aria)}"` : ''} style="${BTN}; background: transparent; border: 2px solid transparent; color: {{t.dim}}">${label}</button>`;
const link = (label, aria, { href = '#' } = {}) => `<a href="${href}" aria-label="${esc(aria)}" style="min-height: 44px; display: inline-flex; align-items: center; padding: 0 10px; font-size: 15px; font-weight: 600; color: {{t.ink}}; text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 5px; text-decoration-color: {{t.dim}}">${label}</a>`;
// League links always run in this order and keep only the ones the league has.
const LINK_ORDER = ['Matchup', 'Lineup', 'Picks', 'Waivers'];
const leagueLinks = (league, which) => `<nav aria-label="${esc(league)}" style="margin-top: auto; display: flex; flex-wrap: wrap; padding: 4px 6px; border-top: 2px solid {{t.rule}}">${LINK_ORDER.filter(l => which.includes(l)).map(l => link(l, `${league} ${l.toLowerCase()}`)).join('')}</nav>`;

// ---- chips ----
const liveChip = (text = 'Live') => `<span style="display: inline-flex; align-items: center; gap: 8px; padding: 8px 10px; border: 2px solid {{t.accent}}; color: {{t.accent}}; ${px(12)}; line-height: 1"><span aria-hidden="true" style="width: 8px; height: 8px; background: {{t.accent}}"></span>${text}</span>`;

// ---- the signature: play cards ----
// The diagram is the card's face: a field band with hash marks, then the play's name, its lock and the foot.
// state: 'next' = the cursor (earliest lock, or the live draft, which leads); 'urgent' = under 1 hour: a red
//   "Locks in 38m" strip, and the red cursor only when it is also the lead; 'open' = plain.
// lead: this card carries the page's one filled button (defaults to the 'next' card).
// actions: one play across several leagues: [{ label, aria }] gives one foot link per league; the card itself is then a group, not a link.
function playCard({ kind, name, league, detail, lockDay, lockTime, lockNote, cta, aria, state = 'open', lead = state === 'next', countdown, actions, phone = false }) {
  const pad = phone ? 12 : 16;
  const footStyle = filled => 'display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 44px; padding: 0 12px; box-sizing: border-box; font-size: 15px; text-decoration: none; ' + (filled
    ? 'background: {{t.playAccent}}; border: 2px solid {{t.playInk}}; color: {{t.onPlayAccent}}; font-weight: 700'
    : 'border: 2px solid {{t.playInk}}; color: {{t.playInk}}; font-weight: 600');
  const foot = actions
    ? '<span style="margin-top: auto; display: flex; flex-direction: column; gap: 8px">' + actions.map((a, i) => '<a href="#" aria-label="' + esc(a.aria) + '" style="' + footStyle(lead && i === 0) + '; padding: 8px 12px"><span style="display: flex; flex-direction: column; line-height: 1.3"><span>' + a.label + '</span><span style="font-size: 14px; font-weight: 400">' + (cta || 'Make picks') + (a.note ? ' · ' + a.note : '') + '</span></span>' + arrow() + '</a>').join('') + '</span>'
    : '<span style="margin-top: auto; ' + footStyle(lead) + '">' + cta + arrow() + '</span>';
  const strip = state === 'urgent' && countdown
    ? '<span style="display: flex; align-items: center; gap: 8px; padding: 8px ' + pad + 'px; background: {{t.danger}}; ' + px(12, '{{t.onDanger}}') + '; line-height: 1.2">' + clock('{{t.onDanger}}') + countdown.replace(/^in /, '') + ' left</span>'
    : '';
  const band = '<span style="display: grid; place-items: center; padding: ' + (phone ? 10 : 14) + 'px 0; background: {{t.playField}}; border-top: 2px dashed {{t.playDim}}; border-bottom: 2px dashed {{t.playDim}}">' + picto(kind, phone ? 96 : 144) + '</span>';
  const inner = strip + band + '<span style="display: flex; flex-direction: column; gap: ' + (phone ? 10 : 14) + 'px; padding: ' + pad + 'px; flex: 1">'
    + '<span style="display: flex; flex-direction: column; gap: 6px"><span style="' + px(phone ? 12 : 16, '{{t.playInk}}') + '">' + name + '</span><span style="font-size: ' + (phone ? 14 : 15) + 'px; color: {{t.playDim}}">' + league + (detail ? ' · ' + detail : '') + '</span></span>'
    + '<span style="display: flex; flex-direction: column; gap: 2px">' + (lockDay === 'Live' ? '<span style="display: inline-flex; align-items: center; gap: 8px; ' + px(16, '{{t.playAccent}}') + '"><span aria-hidden="true" style="width: 8px; height: 8px; background: {{t.playAccent}}"></span>' : '<span style="' + px(12, '{{t.playInk}}') + '">') + [lockDay, lockTime].filter(Boolean).join(' ') + '</span><span style="font-size: 14px; color: {{t.playDim}}">' + lockNote + '</span></span>'
    + foot + '</span>';
  const box = 'display: flex; flex-direction: column; height: 100%; box-sizing: border-box; background: {{t.play}}; color: {{t.playInk}}; text-decoration: none';
  const label = (lead ? 'Next up: ' : '') + name + '. ' + aria + (state === 'urgent' && countdown ? '. ' + countdown.replace(/^in /, '') + ' left' : '');
  const card = actions
    ? '<div role="group" aria-label="' + esc(label) + '" style="' + box + '">' + inner + '</div>'
    : '<a href="#" aria-label="' + esc(label) + '" style="' + box + '">' + inner + '</a>';
  if (!lead) return '<div class="slot" style="--cur: {{t.cursor}}; padding: 8px; border: 4px solid transparent; height: 100%; box-sizing: border-box">' + card + '</div>';
  const ring = state === 'urgent' ? '{{t.danger}}' : '{{t.cursor}}';
  return '<div class="cursor slot" style="--cur: ' + ring + '; padding: 8px; border: 4px solid ' + ring + '; height: 100%; box-sizing: border-box">' + card + '</div>';
}

const ON = { page: { ink: '{{t.ink}}', dim: '{{t.dim}}', rule: '{{t.rule}}' }, board: { ink: '{{t.boardInk}}', dim: '{{t.boardDim}}', rule: '{{t.boardRule}}' } };
// ---- win probability: the odds bar, 20 blocks ----
// live: green only while the matchup is live; before kickoff the bar uses the frame colour.
function oddsBar(pct, { label = true, on: scheme = 'page', live = scheme === 'board' } = {}) {
  const c = ON[scheme];
  const on = Math.round(pct / 5);
  const cells = Array.from({ length: 20 }, (_, i) => `<span style="height: 12px; box-sizing: border-box; ${i < on ? '' : 'border: 2px solid ' + c.dim + ';'} background: ${i < on ? (live ? (scheme === 'board' ? '#2fd97b' : '{{t.accent}}') : '{{t.frame}}') : 'transparent'}"></span>`).join('');
  return `<div style="display: flex; flex-direction: column; gap: 8px"><div role="img" aria-label="Win probability ${pct}%" style="display: grid; grid-template-columns: repeat(20, minmax(0, 1fr)); gap: 2px">${cells}</div>${label ? `<div style="font-size: 14px; color: ${c.dim}"><b style="${px(12, c.ink)}">${pct}%</b> win probability · Endzone Forecast</div>` : ''}</div>`;
}

// ---- matchup sides ----
function sides(you, opp, { size = 24, mid = 'Projected', on: scheme = 'page', youColor, oppColor, youNote = '', oppNote = '' } = {}) {
  const c = ON[scheme]; youColor = youColor || c.ink; oppColor = oppColor || c.ink;
  const fig = (v, c) => `<div style="${px(size, c)}; line-height: 1.2">${v}</div>`;
  const note = n => n ? `<div style="font-size: 13px; color: ${c.dim}; margin-top: 4px">${n}</div>` : '';
  return `<div style="display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: end; gap: 12px">
<div style="min-width: 0"><div style="font-size: 14px; color: ${c.dim}">You</div>${fig(you, youColor)}${note(youNote)}</div>
<div style="font-size: 13px; color: ${c.dim}; padding-bottom: 4px">${mid}</div>
<div style="min-width: 0; text-align: right"><div style="font-size: 14px; color: ${c.dim}; overflow-wrap: anywhere">${opp.name}</div>${fig(opp.score, oppColor)}${note(oppNote)}</div>
</div>`;
}

// ---- live scoreboard tile ----
const boardLink = (label, aria) => '<a href="#" aria-label="' + esc(aria) + '" style="min-height: 44px; display: inline-flex; align-items: center; padding: 0 10px; font-size: 15px; font-weight: 600; color: {{t.boardInk}}; text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 5px; text-decoration-color: {{t.boardDim}}">' + label + '</a>';
const LINKS = ['Matchup', 'Lineup', 'Picks', 'Waivers'];
const boardLinks = (league, which) => !which.length ? '' : '<nav aria-label="' + esc(league) + '" style="display: flex; flex-wrap: wrap; margin: auto -10px -6px; padding-top: 4px; border-top: 2px solid {{t.boardRule}}">' + LINKS.filter(l => which.includes(l)).map(l => boardLink(l, league + ' ' + l.toLowerCase())).join('') + '</nav>';
// A live matchup: the score block is the link to the matchup (aria states the whole score), the status line and the league's other links sit under it.
function scoreTile({ league, aria, you, opp, youLeads, youNote, oppNote, margin, pct, extra = '', status = '', links = ['Lineup', 'Picks', 'Waivers'], phone = false, scored = false }) {
  return '<article style="display: flex; flex-direction: column; gap: 12px; padding: ' + (phone ? 14 : 16) + 'px; background: {{t.board}}; color: {{t.boardInk}}; border: 6px double {{t.boardDim}}; min-width: 0">'
    + '<h3 style="margin: 0; ' + px(16, '{{t.boardInk}}') + '">' + league + '</h3>'
    + (status ? '<div style="font-size: 14px; color: {{t.boardDim}}; margin-top: -6px">' + status + '</div>' : '')
    + '<a href="#"' + (scored ? ' class="scored"' : '') + ' aria-label="' + esc(aria) + '" style="display: flex; flex-direction: column; gap: 12px; color: inherit; text-decoration: none">'
    + sides(you, opp, { size: phone ? 24 : 32, mid: '', on: 'board', youColor: youLeads ? '{{t.boardInk}}' : '{{t.boardDim}}', oppColor: youLeads ? '{{t.boardDim}}' : '{{t.boardInk}}', youNote, oppNote })
    + '<span style="display: flex; align-items: center; justify-content: space-between; gap: 8px"><span style="' + px(16, '{{t.boardInk}}') + '">' + margin + '</span><span style="display: inline-flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600">Matchup' + arrow() + '</span></span>'
    + oddsBar(pct, { on: 'board' }) + '</a>' + extra
    + boardLinks(league, links) + '</article>';
}
// A live pick'em league on the same board. Confidence leagues show points; straight-up leagues may show a record.
function pickemTile({ league, mode = 'Confidence pick\'em', aria, figure, figureLabel, standing, note, links = ['Picks'], phone = false }) {
  return '<article style="display: flex; flex-direction: column; gap: 12px; padding: ' + (phone ? 14 : 16) + 'px; background: {{t.board}}; color: {{t.boardInk}}; border: 6px double {{t.boardDim}}; min-width: 0">'
    + '<h3 style="margin: 0; ' + px(16, '{{t.boardInk}}') + '">' + league + '</h3>'
    + '<div style="font-size: 14px; color: {{t.boardDim}}; margin-top: -6px">' + mode + ' · ' + standing + '</div>'
    + '<a href="#" aria-label="' + esc(aria) + '" style="display: flex; flex-direction: column; gap: 6px; color: inherit; text-decoration: none">'
    + '<span style="' + px(phone ? 24 : 32, '{{t.boardInk}}') + '; line-height: 1.2">' + figure + '</span>'
    + '<span style="display: flex; align-items: center; justify-content: space-between; gap: 8px"><span style="font-size: 15px; color: {{t.boardDim}}">' + figureLabel + '</span><span style="display: inline-flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600">Picks' + arrow() + '</span></span>'
    + '<span style="font-size: 14px; color: {{t.boardDim}}">' + note + '</span></a>'
    + boardLinks(league, links.filter(l => l !== 'Picks')) + '</article>';
}

// ---- league panel (team-data screen) ----
function leaguePanel({ name, right, body, links, phone = false, id }) {
  return `<article${id ? ` aria-labelledby="${id}"` : ''} style="${FRAME}; display: flex; flex-direction: column; min-width: 0">
<div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px 12px; padding: 12px ${phone ? 14 : 16}px; border-bottom: 2px solid {{t.rule}}">
<h3${id ? ` id="${id}"` : ''} style="margin: 0; ${px(12, '{{t.ink}}')}"><a href="#" style="color: inherit; text-decoration: none">${name}</a></h3>${right ? `<span style="font-size: 14px; color: {{t.dim}}">${right}</span>` : ''}
</div>
<div style="padding: ${phone ? 14 : 16}px; display: flex; flex-direction: column; gap: 16px">${body}</div>
${links || ''}
</article>`;
}

// ---- one-line league row (game day) ----
function leagueRow({ name, status, links }) {
  return `<article style="${FRAME}; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px 12px; padding: 8px 8px 8px 16px">
<div style="min-width: 0"><h3 style="margin: 0; ${px(12)}"><a href="#" style="color: inherit; text-decoration: none">${name}</a></h3><div style="font-size: 14px; color: {{t.dim}}">${status}</div></div>
<div style="display: flex; flex-wrap: wrap">${links}</div>
</article>`;
}

// ---- states ----
const errorPanel = ({ title, body, retryAria }) => `<div role="alert" style="border: 6px double {{t.danger}}; background: {{t.panel}}; padding: 16px 20px; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px 20px">
<div style="display: flex; gap: 12px; align-items: flex-start; min-width: 0">${warn('{{t.danger}}')}<div><div style="${px(12, '{{t.ink}}')}">${title}</div><div style="font-size: 15px; color: {{t.dim}}; margin-top: 4px">${body}</div></div></div>
${btnGhost('Try again', { aria: retryAria })}
</div>`;
const emptyPlays = () => `<div style="padding: 20px; display: flex; align-items: center; gap: 16px"><span style="${px(12)}">Nothing needs you right now.</span></div>`;
const skel = (w, h) => `<span aria-hidden="true" style="display: block; width: ${w}; height: ${h}px; background: {{t.skel}}"></span>`;
const help = ({ phone } = {}) => `<details style="font-size: 14px; color: {{t.dim}}; position: relative"><summary style="cursor: pointer; min-height: 44px; display: inline-flex; align-items: center; gap: 10px; font-weight: 600; color: {{t.ink}}"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M1 1h14v14H1zM3 3v10h10V3zM7 4h2v2H7zM7 7h2v5H7z" fill="currentColor" fill-rule="evenodd"/></svg>What the numbers mean</summary><dl style="margin: 4px 0 0; display: grid; grid-template-columns: ${phone ? '1fr' : 'max-content 1fr'}; gap: 6px 16px; max-width: 760px"><dt style="font-weight: 600; color: {{t.ink}}">Projected</dt><dd style="margin: 0">Each lineup's points from Endzone Forecast, our projection engine.</dd><dt style="font-weight: 600; color: {{t.ink}}">Win probability</dt><dd style="margin: 0">Your chance to win the matchup from both lineups' projected finals. It sharpens as games finish.</dd><dt style="font-weight: 600; color: {{t.ink}}">Confidence</dt><dd style="margin: 0">In a Confidence pick'em, each pick carries a number from 1 up to that week's game count, each used once. A right pick earns that many points.</dd></dl></details>`;

// ---- page shell ----
const HELMET = `<helmet>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&amp;family=Press+Start+2P&amp;display=swap">
<style>
html,body{margin:0;height:100%}
a{color:inherit}
a:hover,button:hover{filter:brightness(1.12)}
button{font-family:inherit;cursor:pointer}
:focus-visible{outline:3px solid #ffffff;outline-offset:0;box-shadow:0 0 0 7px #07080f}
::selection{background:#f8d030;color:#07080f}
details>summary{list-style:none}details>summary::-webkit-details-marker{display:none}
.cursor{animation:blink .5s steps(1) 3}
@keyframes blink{50%{border-color:transparent}}
@media (hover:hover){.slot:hover{border-color:var(--cur)!important}section:has(.slot:hover) .cursor:not(:hover):not(:focus-within){border-color:transparent!important;animation:none}}
.slot:focus-within{border-color:var(--cur)!important}
section:has(.slot:focus-within) .cursor:not(:focus-within){border-color:transparent!important;animation:none}
.slot:active{border-color:#ffffff!important}
.slot:active>*{transform:translate(2px,2px)}
.scored{animation:scored .3s steps(1) 3}
@keyframes scored{50%{background:#ffffff29;outline:6px solid #ffffff29}}
@keyframes scoredHold{0%{background:#ffffff29;outline:6px solid #ffffff29}}
@media (prefers-reduced-motion:reduce){.cursor{animation:none}.slot:active>*{transform:none}.scored{animation:scoredHold 1s steps(1) 1}}
</style>
</helmet>`;

function page({ title, w, h, body, phone = false }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
${HELMET}
<div style="background: {{t.bg}}; color: {{t.ink}}; font-family: ${BODY}; font-size: 16px; line-height: 1.5; min-height: 100vh">
${body}
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"light":{"editor":"boolean","default":false},"$preview":{"width":${w},"height":${h}}}'>
class Component extends DCLogic {
  renderVals() {
    const dark = ${JSON.stringify(TOKENS.dark)};
    const light = ${JSON.stringify(TOKENS.light)};
    return { t: this.props.light ? light : dark };
  }
}
</script>
</body>
</html>
`;
}

// Design notes for engineers: small, last, outside the product content.
const notes = lines => `<aside aria-label="Design notes" style="display: flex; flex-direction: column; gap: 4px; padding-top: 16px; border-top: 2px dashed {{t.rule}}; font-size: 13px; color: {{t.dim}}">${lines.map(l => `<span>${l}</span>`).join('')}</aside>`;

const write = (dir, file, html) => fs.writeFileSync(path.join(dir, file), html);

module.exports = { picto, pickemTile, boardLinks, scoreTile, PX, BODY, TOKENS, SR, px, h1, h2, meta, arrow, clock, warn, picto, FRAME, frameHead, badge, btnFill, btnGhost, btnQuiet, link, leagueLinks, liveChip, playCard, oddsBar, sides, leaguePanel, leagueRow, errorPanel, emptyPlays, skel, help, page, notes, write, esc };
