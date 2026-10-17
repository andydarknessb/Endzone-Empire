// League Play-select kit: the Home kit plus the pieces every /league/:id/* page needs.
// Same rules as kit.js: functions return markup strings with {{t.x}} holes, square corners, no shadows, stepped motion only.
const k = require('./kit');
const { px, esc, SR, arrow, warn, clock, FRAME, frameHead, h2, btnGhost, btnFill, link, oddsBar, picto } = k;
// Container tiers: Board black = live; FRAME (6px double) = primary frames; FRAME2 (2px single Rule) with a Pixel 16 h2 = tertiary frames.
const FRAME2 = 'border: 2px solid {{t.frame2}}; background: {{t.panel}}';
const h2s = (id, text) => `<h2 id="${id}" style="margin: 0; ${px(16)}">${text}</h2>`;
// Meta lines wrap with text-wrap: pretty so a phone never strands one word.
const meta = (text, extra = '') => `<span style="font-size: 13px; color: {{t.dim}}; text-wrap: pretty; ${extra}">${String(text).replace('Endzone Forecast', '<span style="white-space: nowrap">Endzone Forecast</span>')}</span>`;
// A short trailing figure ("by 0.2", "Up 6.5") never breaks across lines.
const nb = s => String(s).replace(/\b((?:by|Up|up) \d+(?:\.\d+)?)/g, '<span style="white-space: nowrap">$1</span>');

// ---- tokens ----
const POS_DARK = { Qb: '#ff8a80', Rb: '#7ee2a8', Wr: '#7fb0ff', Te: '#f0b34e', K: '#c4a2f5', Def: '#b0bec5', Idp: '#4db6ac' };
const POS_LIGHT = { Qb: '#c62828', Rb: '#15663f', Wr: '#1e5bb8', Te: '#9a5100', K: '#6d28d9', Def: '#4b5c66', Idp: '#008477' };
const GRADE = { gradeA: '#2fd97b', gradeB: '#a8cc4a', gradeC: '#e5b04a', gradeD: '#e07a45', gradeF: '#e25c5c' };
const pos = (m, suffix = '') => Object.fromEntries(Object.entries(m).map(([n, v]) => ['pos' + n + suffix, v]));
// posXxxBoard: Board is black in both themes, so position tags on it always use the dark values.
const common = { ...GRADE, onGrade: '#07080f', boardLive: '#2fd97b', ...pos(POS_DARK, 'Board') };
const TOKENS = {
  // chip: the one border colour for every head chip (the live chip keeps its green: Green Means Go).
  dark: { ...k.TOKENS.dark, ...pos(POS_DARK), ...common, scrim: '#07080fe6', chip: k.TOKENS.dark.ink, frame2: k.TOKENS.dark.rule },
  light: { ...k.TOKENS.light, ...pos(POS_LIGHT), ...common, scrim: '#eceef8e6', chip: k.TOKENS.light.ink, frame2: k.TOKENS.light.frame },
};

// ---- page shell: Home's page with the extended tokens and the league controls' CSS ----
// Toggle and radio cards keep their selected look in CSS (:checked) so the static markup is honest about state.
const LEAGUE_CSS = `body{font-variant-numeric:tabular-nums}
.tg,.rc{position:relative}
.sw{position:absolute;left:0;top:0;width:44px;height:44px;margin:0;opacity:0;cursor:pointer}
.tg-track{width:44px;height:24px;box-sizing:border-box;border:2px solid var(--off);position:relative;flex:none}
.tg-knob{position:absolute;top:2px;left:2px;width:16px;height:16px;background:var(--off)}
.sw:checked+.tg-track{background:var(--on);border-color:var(--onInk)}
.sw:checked+.tg-track .tg-knob{left:22px;background:var(--onInk)}
.sw:focus-visible+.tg-track{outline:3px solid #ffffff;box-shadow:0 0 0 7px #07080f}
.sw:disabled+.tg-track{cursor:not-allowed}
.tg-state::before{content:'Off'}.sw:checked~.tg-state::before{content:'On'}
.rc .sw{width:100%;height:100%}
.rc-card{display:flex;gap:12px;align-items:flex-start;box-sizing:border-box;height:100%;min-height:44px;padding:12px 14px;border:2px solid var(--off)}
.rc-dot{flex:none;width:16px;height:16px;box-sizing:border-box;border:2px solid currentColor;margin-top:3px;display:grid;place-items:center}
.sw:checked+.rc-card{background:var(--on);color:var(--onInk);border-color:var(--onInk)}
.sw:checked+.rc-card .rc-dot::after{content:'';width:6px;height:6px;background:currentColor}
.sw:focus-visible+.rc-card{outline:3px solid #ffffff;box-shadow:0 0 0 7px #07080f}
.sw:disabled+.rc-card{cursor:not-allowed}
.sw:disabled:not(:checked)+.rc-card{color:var(--off)}
.pb:hover,.pb:focus-visible{background:var(--on)!important;color:var(--onInk)!important}`;
const PBV = '--on: {{t.play}}; --onInk: {{t.playInk}}; --off: {{t.dim}}';

function page(opts) {
  let html = k.page(opts);
  html = html.replace(JSON.stringify(k.TOKENS.dark), JSON.stringify(TOKENS.dark)).replace(JSON.stringify(k.TOKENS.light), JSON.stringify(TOKENS.light));
  if (!html.includes('class="scored"')) html = html.replace('.scored{animation:scoredHold 1s steps(1) 1}', '').split('\n').filter(l => !/^(.scored|@keyframes scored)/.test(l)).join('\n');
  return html.replace('</style>', LEAGUE_CSS + '\n</style>');
}

// ---- forced states (reference sheet only) ----
const FOCUS = 'outline: 3px solid #ffffff; outline-offset: 0; box-shadow: 0 0 0 7px #07080f';
const stateStyle = s => (s === 'focus' ? FOCUS : s === 'hover' ? 'filter: brightness(1.12)' : '');
const force = (html, s) => html.replace('style="', `style="${stateStyle(s)}; `);
const btnDisabled = label => `<button type="button" disabled style="min-height: 44px; display: inline-flex; align-items: center; padding: 0 16px; box-sizing: border-box; border-radius: 0; font-family: inherit; font-size: 15px; font-weight: 600; background: transparent; border: 2px dashed {{t.rule}}; color: {{t.dim}}; cursor: not-allowed">${label}</button>`;

// ---- small pieces ----
const POSKEY = { QB: 'Qb', RB: 'Rb', WR: 'Wr', TE: 'Te', K: 'K', DEF: 'Def', IDP: 'Idp' };
// Position tag: the position letters carry the meaning; the colour is a secondary cue and never the only one.
const posTag = (p, { on = 'page' } = {}) => {
  const c = `{{t.pos${POSKEY[p] || 'Def'}${on === 'board' ? 'Board' : ''}}}`;
  return `<span style="display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; min-width: 40px; height: 24px; padding: 0 6px; border: 2px solid ${c}; color: ${c}; font-size: 13px; font-weight: 700; line-height: 1">${p}</span>`;
};
const gradeChip = g => `<span role="img" aria-label="Grade ${g}" style="display: inline-grid; place-items: center; width: 32px; height: 32px; background: {{t.grade${g}}}; color: {{t.onGrade}}; ${px(16)}; line-height: 1">${g}</span>`;
const STATUS_WORD = /^(Scheduled|Live|Final|Recap|Awaiting final)$/i;
// chip: a status word in Pixel 16 with the one chip border token (phase, Scheduled, Final, Recap).
const chip = (text, { c = '{{t.chip}}' } = {}) => `<span style="display: inline-flex; align-items: center; box-sizing: border-box; padding: 8px 10px; border: 2px solid ${c}; ${px(16)}; line-height: 1; flex: none; white-space: nowrap">${text}</span>`;
const kindTag = (text, { w = 72 } = {}) => STATUS_WORD.test(text) ? chip(text) : `<span style="display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; min-width: ${w}px; height: 28px; padding: 0 8px; border: 2px solid {{t.rule}}; color: {{t.ink}}; font-size: 13px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; line-height: 1; flex: none">${text}</span>`;
const youBadge = (c = '{{t.ink}}') => `<span style="display: inline-flex; align-items: center; box-sizing: border-box; height: 22px; padding: 0 6px; border: 2px solid ${c}; font-size: 13px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; line-height: 1; flex: none">You</span>`;
const avatar = (name, { size = 28, c = '{{t.ink}}' } = {}) => `<span aria-hidden="true" style="display: inline-grid; place-items: center; flex: none; width: ${size}px; height: ${size}px; box-sizing: border-box; border: 2px solid ${c}; font-size: 13px; font-weight: 700; line-height: 1">${name.split(' ').slice(0, 2).map(w => w[0]).join('')}</span>`;
const liveChipBoard = (text = 'Live') => `<span style="display: inline-flex; align-items: center; gap: 8px; padding: 8px 10px; border: 2px solid {{t.boardLive}}; color: {{t.boardLive}}; ${px(16)}; line-height: 1"><span aria-hidden="true" style="width: 8px; height: 8px; background: {{t.boardLive}}"></span>${text}</span>`;
// One cursor on a row (Lineup slot, Draft pick, pending join request): same frame as the lead play card.
const cursorRow = (inner, { urgent = false } = {}) => `<div class="cursor slot" style="--cur: ${urgent ? '{{t.danger}}' : '{{t.cursor}}'}; padding: 8px; border: 4px solid ${urgent ? '{{t.danger}}' : '{{t.cursor}}'}; box-sizing: border-box">${inner}</div>`;
const breadcrumb = (trail, current) => `<nav aria-label="Breadcrumb"><ol style="list-style: none; margin: 0 0 0 -10px; padding: 0; display: flex; flex-wrap: wrap; align-items: center">${trail.map(t => `<li style="display: flex; align-items: center">${link(t, t)}<span aria-hidden="true" style="color: {{t.dim}}; display: inline-flex">${arrow()}</span></li>`).join('')}<li aria-current="page" style="min-height: 44px; display: inline-flex; align-items: center; padding: 0 10px; font-size: 15px; font-weight: 600; color: {{t.dim}}">${current}</li></ol></nav>`;

// ---- table ----
// cols: [{ label, align, w }]. The first column is sticky. rows: arrays of cell html, or { cut: 'Playoff line' }.
// viewer: index among the data rows of the viewer's row (Play-blue fill, never a cursor).
function table({ label, cols, rows, viewer = -1, minW = 0 }) {
  const th = (c, i) => `<th scope="col" style="${i === 0 ? 'position: sticky; left: 0; z-index: 1; ' : ''}box-sizing: border-box; ${c.w ? `width: ${c.w}px; min-width: ${c.w}px; ` : ''}height: 40px; padding: 0 12px; text-align: ${c.align || 'left'}; background: {{t.panel}}; border-bottom: 2px solid {{t.rule}}; font-size: 13px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: {{t.dim}}; white-space: nowrap">${c.label}</th>`;
  let di = -1;
  const body = rows.map((r, ri) => {
    if (r.cut) return `<tr><td colspan="${cols.length}" style="padding: 0; background: {{t.panel}}"><div style="display: flex; align-items: center; height: 32px"><span style="position: sticky; left: 0; flex: none; padding: 0 12px; background: {{t.panel}}; line-height: 32px; font-size: 13px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: {{t.dim}}">${r.cut}</span><div aria-hidden="true" style="flex: 1; border-top: 2px dashed {{t.frame}}"></div></div></td></tr>`;
    di++;
    const v = di === viewer;
    const nextCut = rows[ri + 1] && rows[ri + 1].cut, last = ri === rows.length - 1;
    const bd = last || nextCut ? '0' : `2px solid ${v ? '{{t.playField}}' : '{{t.rule}}'}`;
    const bg = v ? '{{t.play}}' : '{{t.panel}}', fg = v ? '{{t.playInk}}' : '{{t.ink}}';
    return `<tr${v ? ' aria-current="true"' : ''}>${r.map((cell, i) => {
      const c = cols[i];
      const st = `box-sizing: border-box; height: 44px; padding: 0 12px; text-align: ${c.align || 'left'}; background: ${bg}; color: ${fg}; border-bottom: ${bd}; white-space: nowrap; font-size: 15px`;
      return i === 0 ? `<th scope="row" style="position: sticky; left: 0; z-index: 1; ${st}; font-weight: 600">${cell}</th>` : `<td style="${st}">${cell}</td>`;
    }).join('')}</tr>`;
  }).join('');
  return `<div role="region" aria-label="${esc(label)}" tabindex="0" style="overflow-x: auto"><table style="width: 100%; border-collapse: separate; border-spacing: 0; min-width: ${minW}px"><caption style="${SR}">${label}</caption><thead><tr>${cols.map(th).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
}

// Standings: a framed Tecmo ranking screen. data: [{ rank, team, w, l, t, pf, pa, strk }]. The viewer's row wears the Play-blue fill and an arrow.
function standings({ data, viewer, cutAfter, title = 'Standings', id = 'st-h', phone = false }) {
  const rows = [];
  data.forEach((d, i) => {
    const me = i === viewer, c = me ? '{{t.playInk}}' : '{{t.ink}}';
    rows.push([
      d.rank,
      `<span style="display: flex; align-items: center; gap: 10px"><span aria-hidden="true" style="width: 12px; flex: none; display: inline-flex">${me ? arrow() : ''}</span>${avatar(d.team, { c })}<a href="#" style="display: flex; align-items: center; min-height: 44px; font-size: 15px; font-weight: 600; color: inherit; text-decoration: none">${d.team}</a>${me ? youBadge(c) : ''}</span>`,
      `${d.w}-${d.l}-${d.t}`, d.pf, d.pa, d.strk,
    ]);
    if (i + 1 === cutAfter) rows.push({ cut: 'Playoff line' });
  });
  const cols = [{ label: phone ? '#' : 'Rank', w: 64 }, { label: 'Team', w: 300 }, { label: 'W-L-T', align: 'right', w: 88 }, { label: 'PF', align: 'right', w: 88 }, { label: 'PA', align: 'right', w: 88 }, { label: 'STRK', align: 'right', w: 72 }];
  return `<section aria-labelledby="${id}" style="${FRAME}; min-width: 0">${frameHead(`${h2(id, title, { phone })}${meta(`${data.length} teams`, 'margin-left: auto')}`, { phone })}${table({ label: `${title}, ${data.length} teams`, cols, rows, viewer, minW: 700 })}</section>`;
}

// ---- matchup panels ----
const sideBlock = (s, { right = false, lead = true, c = ON.page, label = 'Proj', note = '', expected = '', under } = {}) => `<div style="min-width: 0; text-align: ${right ? 'right' : 'left'}"><div style="display: flex; align-items: center; gap: 10px; ${right ? 'flex-direction: row-reverse' : ''}">${avatar(s.name, { c: c.ink })}<h3 style="margin: 0; min-width: 0; ${px(16, c.ink)}; overflow-wrap: anywhere">${s.name}</h3></div><div style="display: flex; align-items: center; gap: 8px; font-size: 13px; color: ${c.dim}; margin-top: 12px; ${right ? 'justify-content: flex-end' : ''}">${s.you ? youBadge(c.ink) : ''}${label}</div><div style="${px(32, lead ? c.ink : c.dim)}; line-height: 1.2; margin-top: 4px">${s.fig}</div>${under !== undefined ? `<div style="${px(16, c.ink)}; margin-top: 8px; min-height: 24px; white-space: nowrap">${under}</div>` : ''}${expected ? `<div style="font-size: 15px; color: ${c.dim}; margin-top: 8px">Expected final <b style="font-weight: 600; color: ${c.ink}; white-space: nowrap">${expected}</b></div>` : ''}${note ? `<div style="font-size: 14px; color: ${c.dim}; margin-top: 4px">${note}</div>` : ''}</div>`;
const ON = { page: { ink: '{{t.ink}}', dim: '{{t.dim}}' }, board: { ink: '{{t.boardInk}}', dim: '{{t.boardDim}}' } };

// Pre-kickoff versus panel: framed, projected figures, Frame-colour odds bar.
function versusPanel({ week = 7, you, opp, pct, margin, narrative, kickoff, id = 'vs-h', extra = '', pad = 20, gap = 20 }) {
  return `<section aria-labelledby="${id}" style="${FRAME}; display: flex; flex-direction: column; box-sizing: border-box; min-width: 0">${frameHead(`${h2(id, `Week ${week} Matchup`)}${kindTag('Scheduled', { w: 0 })}${kickoff ? meta(kickoff, 'margin-left: auto') : ''}`)}
<div style="padding: ${pad}px; display: flex; flex-direction: column; justify-content: space-between; gap: ${gap}px; flex: 1">
<div style="display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); gap: 16px; align-items: end">${sideBlock({ ...you, you: true })}<span style="padding-bottom: 8px; font-size: 15px; font-weight: 600; color: {{t.dim}}">vs</span>${sideBlock(opp, { right: true })}</div>
${oddsBar(pct, { name: you.name })}
<div style="display: flex; flex-direction: column; gap: 6px"><div style="font-size: 16px"><span style="color: {{t.dim}}">Projected margin ·</span> <b style="font-weight: 700">${nb(margin)}</b></div>${narrative ? `<p style="margin: 0; font-size: 15px; color: {{t.dim}}; text-wrap: pretty">${narrative}</p>` : ''}</div>
${extra}<div>${btnGhost('Matchup', { tag: 'a', aria: `Matchup, ${you.name} against ${opp.name}` })}</div>
</div></section>`;
}

// Live versus screen: the Board-black scoreboard scaled up. The score block is one link; .scored flashes it.
function versusLive({ week = 7, you, opp, youLeads = true, margin, pct, aria, scored = false, updated = '', id = 'vl-h', sentence = '' }) {
  const c = ON.board;
  return `<section aria-labelledby="${id}" style="display: flex; flex-direction: column; gap: 16px; padding: 18px; box-sizing: border-box; background: {{t.board}}; color: {{t.boardInk}}; border: 6px double {{t.boardDim}}; min-width: 0">
<div style="display: flex; flex-wrap: wrap; align-items: flex-start; gap: 8px 16px">${h2(id, `Week ${week} Matchup`)}${liveStamp(updated)}</div>
${sentence ? `<p aria-live="polite" style="margin: 0; ${SR}">${sentence}</p>` : ''}
<a href="#"${scored ? ' class="scored"' : ''} aria-label="${esc(aria)}" style="display: flex; flex-direction: column; gap: 20px; padding: 0; color: inherit; text-decoration: none">
<div style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 24px; align-items: start">${sideBlock({ ...you, you: true }, { lead: youLeads, c, label: 'Live score', note: you.note, expected: you.expected, under: margin })}${sideBlock(opp, { right: true, lead: !youLeads, c, label: 'Live score', note: opp.note, expected: opp.expected, under: '' })}</div>
<div style="display: flex; flex-direction: column; align-items: flex-start; gap: 16px; width: 100%">${oddsBar(pct, { on: 'board', name: you.name }).replace('<div style="display: flex;', '<div style="width: 100%; display: flex;')}<span style="display: inline-flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600">Matchup${arrow()}</span></div>
</a></section>`;
}

// LIVE chip with the honest stamp under it (the dashboard does not poll).
const liveStamp = stamp => `<span style="display: inline-flex; flex-direction: column; align-items: flex-start; gap: 4px">${liveChipBoard()}${stamp ? `<span style="font-size: 13px; color: {{t.boardDim}}">${stamp}</span>` : ''}</span>`;
// Starter figures carry a column label: "Proj" before kickoff; on game day "Pts" (live) then "Proj".
const figCols = (s, live) => live ? `<span style="display: flex; gap: 12px; flex: none"><span style="width: 44px; text-align: right; font-size: 15px; font-weight: 600">${s.pts == null ? '<span aria-hidden="true">-</span><span style="' + SR + '">Not started</span>' : Number(s.pts).toFixed(1)}</span><span style="width: 44px; text-align: right; font-size: 15px; font-weight: 600; color: {{t.dim}}">${s.proj}</span></span>` : `<span style="width: 44px; text-align: right; font-size: 15px; font-weight: 600">${s.proj}</span>`;
const figHead = live => `<span aria-hidden="true" style="display: flex; gap: 12px; flex: none; font-size: 13px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: {{t.dim}}">${live ? '<span style="width: 44px; text-align: right">Pts</span>' : ''}<span style="width: 44px; text-align: right">Proj</span></span>`;
const startersHead = live => `<div style="display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 4px"><h3 style="margin: 0; font-size: 13px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: {{t.dim}}">Starters · Week 7</h3>${figHead(live)}</div>`;
// ---- my team ----
const injury = q => `<span style="display: inline-grid; place-items: center; ${q === 'O' ? 'padding: 0 6px; background: {{t.ink}}; color: {{t.panel}}; letter-spacing: .04em; height: 24px' : 'width: 24px; height: 24px'}; box-sizing: border-box; border: 2px solid {{t.ink}}; font-size: 13px; font-weight: 700; line-height: 1"><span aria-hidden="true">${q === 'O' ? 'OUT' : q}</span><span style="${SR}">${{ Q: 'Questionable', D: 'Doubtful', O: 'Out', IR: 'Injured reserve' }[q] || q}</span></span>`;
const statusRow = (status, name, fix = false) => `<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 0 8px; font-size: 15px; font-weight: 600">${status}${fix && /incomplete/i.test(status) ? link('Fix lineup', `Fix lineup, ${name}`) : ''}</div>`;
function myTeam({ name, record, rankLine, pf, pa, nextLock, lockNote, starters, more, status, id = 'mt-h', live = false, fix = false, phone = false }) {
  const stat = (l, v) => `<div style="display: flex; flex-direction: column; gap: 2px"><span style="font-size: 13px; color: {{t.dim}}">${l}</span><span style="font-size: 16px; font-weight: 600">${v}</span></div>`;
  const rows = starters.map(s => `<li style="display: flex; align-items: center; gap: 12px; min-height: 44px; border-bottom: 2px solid {{t.rule}}">${posTag(s.slot)}<div style="flex: 1; min-width: 0"><div style="display: flex; align-items: center; gap: 8px"><span style="font-size: 15px; font-weight: 600">${s.name}</span>${s.inj ? injury(s.inj) : ''}</div><div style="font-size: 13px; color: {{t.dim}}">${s.game}</div></div>${figCols(s, live)}</li>`).join('');
  return `<section aria-labelledby="${id}" style="${FRAME}; display: flex; flex-direction: column; min-width: 0">${frameHead(`${h2(id, name, { phone })}${youBadge()}${meta(rankLine, 'margin-left: auto')}`)}
<div style="padding: 20px; display: flex; flex-direction: column; gap: 16px; flex: 1">
<div style="display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px 28px; padding-bottom: 16px; border-bottom: 2px solid {{t.rule}}"><div><div style="font-size: 13px; color: {{t.dim}}">Record</div><div style="${px(24)}; line-height: 1.3">${record}</div></div>${stat('Points for', pf)}${stat('Points against', pa)}</div>
<div>${startersHead(live)}<ul style="list-style: none; margin: 0; padding: 0">${rows}</ul><p style="margin: 8px 0 0; font-size: 14px; color: {{t.dim}}">${more}</p></div>
<div style="margin-top: auto">${statusRow(status, name, fix)}</div>
</div>
<nav aria-label="${esc(name)}" style="display: flex; flex-wrap: wrap; padding: 4px 6px; border-top: 2px solid {{t.rule}}">${['Lineup', 'Waivers', 'Trades'].map(l => link(l, `${name} ${l.toLowerCase()}`)).join('')}</nav></section>`;
}

// ---- recap, around the league ----
function recapPanel({ week = 6, body, facts, generated, id = 'rc-h' }) {
  return `<section aria-labelledby="${id}" style="${FRAME2}; min-width: 0">${frameHead(`${h2s(id, `Week ${week} Recap`)}${meta(generated, 'margin-left: auto')}`)}
<div style="display: flex; flex-direction: column; gap: 16px; padding: 20px">
<p style="margin: 0; font-size: 16px; max-width: 80ch; text-wrap: pretty">${body}</p>
<dl style="margin: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 0 24px; border-top: 2px solid {{t.rule}}">${facts.map(([l, v], i) => `<div style="display: flex; flex-direction: column; gap: 2px; padding: 10px 0"><dt style="font-size: 13px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: {{t.dim}}">${l}</dt><dd style="margin: 0; font-size: 15px; font-weight: 600; text-wrap: pretty">${nb(v)}</dd></div>`).join('')}</dl>
<div style="margin-left: -10px">${link('Read the full recap', `Read the full Week ${week} recap`)}</div>
</div></section>`;
}
// A small matchup tile, framed before kickoff. a/b: { name, fig, you }.
function aroundTile({ a, b, pct, aria }) {
  const row = s => `<div style="display: flex; align-items: center; gap: 10px; min-width: 0">${avatar(s.name)}<span style="flex: 1; min-width: 0; font-size: 15px; font-weight: 600">${s.name}</span>${s.you ? youBadge() : ''}<span style="${px(16)}">${s.fig}</span></div>`;
  return `<a href="#" aria-label="${esc(aria)}" style="border: 2px solid {{t.frame}}; background: {{t.panel}}; display: flex; flex-direction: column; gap: 12px; padding: 14px; box-sizing: border-box; height: 100%; color: inherit; text-decoration: none; min-width: 0"><span aria-hidden="true" style="margin: -4px 0 -6px; text-align: right; font-size: 13px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: {{t.dim}}">Proj</span>${row(a)}${row(b)}${oddsBar(pct, { label: false, name: a.name })}<div style="font-size: 13px; color: {{t.dim}}"><b style="color: {{t.ink}}">${pct}%</b> ${a.name}</div></a>`;
}
// The sixth grid cell: a dashed link tile to the full Game Center.
const aroundMore = (label, aria) => `<a href="#" aria-label="${esc(aria)}" style="display: flex; align-items: center; justify-content: center; gap: 10px; box-sizing: border-box; height: 100%; min-height: 88px; border: 2px dashed {{t.frame}}; color: inherit; font-size: 15px; font-weight: 600; text-decoration: none">${label}${arrow()}</a>`;

// ---- playbook ----
const LP = (() => {
  const cells = (x0, y0, rows) => rows.map((r, j) => [...r].map((c, i) => c === '#' ? 'M' + (x0 + i * 2) + ' ' + (y0 + j * 2) + 'h2v2h-2z' : '').join('')).join('');
  const O = (x, y) => cells(x - 6, y - 6, ['.####.', '#....#', '#....#', '#....#', '#....#', '.####.']);
  const X = (x, y) => cells(x - 5, y - 5, ['#...#', '.#.#.', '..#..', '.#.#.', '#...#']);
  const H = (x1, x2, y) => 'M' + x1 + ' ' + y + 'h' + (x2 - x1) + 'v2h' + (x1 - x2) + 'z';
  const V = (x, y1, y2) => 'M' + x + ' ' + y1 + 'h2v' + (y2 - y1) + 'h-2z';
  const dashH = (x1, x2, y) => { let d = ''; for (let x = x1; x < x2; x += 8) d += H(x, Math.min(x + 4, x2), y); return d; };
  const headR = (x, y) => cells(x, y - 6, ['#...', '##..', '###.', '####', '###.', '##..', '#...']);
  const box = (x, y, w, h) => H(x, x + w, y) + H(x, x + w, y + h - 2) + V(x, y, y + h) + V(x + w - 2, y, y + h);
  return {
    // the scoreboard: a header bar, the home O and the visitor X
    gamecenter: box(14, 4, 68, 40) + H(14, 82, 14) + V(46, 14, 44) + O(30, 29) + X(64, 29),
    // the week's moves: a stepped route climbing the board
    activity: dashH(4, 92, 44) + H(8, 24, 36) + V(22, 28, 38) + H(22, 40, 28) + V(38, 20, 30) + H(38, 58, 20) + headR(58, 21) + X(76, 14),
    // the ranking: a podium of three columns with an O on each
    rankings: H(14, 82, 44) + box(18, 26, 20, 18) + box(38, 14, 20, 30) + box(58, 32, 20, 12) + O(28, 18) + O(48, 6) + O(68, 24),
    // the past: three seasons, one O in each box
    history: box(6, 10, 22, 28) + box(37, 10, 22, 28) + box(68, 10, 22, 28) + O(17, 24) + O(48, 24) + O(79, 24) + dashH(28, 37, 23) + dashH(59, 68, 23),
    // the rulebook: a clipboard
    rules: box(26, 4, 44, 40) + H(38, 58, 2) + H(36, 60, 16) + H(36, 60, 24) + H(36, 52, 32),
  };
})();
const leaguePicto = (kind, w = 96, color = '{{t.playInk}}') => LP[kind] ? `<svg width="${w}" height="${w / 2}" viewBox="0 0 96 48" aria-hidden="true" shape-rendering="crispEdges" style="display: block; flex: none"><path d="${LP[kind]}" fill="${color}"/></svg>` : picto(kind, w, color);
// No filled foot: only the lead play card carries the one filled action.
const playbookTile = ({ kind, label, status, aria }) => `<a href="#"${aria ? ` aria-label="${esc(aria)}"` : ''} style="display: flex; align-items: center; gap: 14px; min-height: 44px; padding: 12px 14px; box-sizing: border-box; background: {{t.play}}; border: 2px solid {{t.playInk}}; color: {{t.playInk}}; text-decoration: none">${leaguePicto(kind)}<span style="display: flex; flex-direction: column; gap: 2px; min-width: 0"><span style="font-size: 15px; font-weight: 600">${label}</span><span style="font-size: 14px; color: {{t.playDim}}">${status}</span></span></a>`;
// groups: [{ name, tiles: [tileArgs] }]
function playbook({ groups, id = 'pb-h' }) {
  return `<section aria-labelledby="${id}" style="${FRAME2}">${frameHead(`${h2s(id, 'Playbook')}${meta('Everything else in this league', 'margin-left: auto')}`)}<div style="padding: 20px; display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 24px">${groups.map((g, i) => `<div style="display: flex; flex-direction: column; gap: 10px"><h3 style="margin: 0; font-size: 13px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: {{t.dim}}">${g.name} · ${g.tiles.length}</h3>${g.tiles.map(playbookTile).join('')}</div>`).join('')}</div></section>`;
}

// ---- trophies: pixel pictograms on a 2px grid (viewBox = cells x 2) ----
const SPRITES = {
  cup: ['....############....', '....############....', '##..############..##', '#.#.############.#.#', '#.#.############.#.#', '##..############..##', '....############....', '.....##########.....', '......########......', '.......######.......', '........####........', '.........##.........', '.........##.........', '.......######.......', '......########......', '......########......'],
  star: ['.......##.......', '.......##.......', '......####......', '......####......', '################', '.##############.', '..############..', '...##########...', '...##########...', '..####....####..', '..###......###..', '.###........###.', '.##..........##.'],
};
const trophyPicto = (kind = 'cup', scale = 3, color = '{{t.frame}}') => {
  const rows = SPRITES[kind], w = rows[0].length;
  rows.forEach(r => { if (r.length !== w) throw new Error('sprite width ' + kind); });
  const d = rows.map((r, j) => [...r].map((c, i) => c === '#' ? `M${i * 2} ${j * 2}h2v2h-2z` : '').join('')).join('');
  return `<svg width="${w * scale}" height="${rows.length * scale}" viewBox="0 0 ${w * 2} ${rows.length * 2}" aria-hidden="true" shape-rendering="crispEdges" style="display: block; flex: none"><path d="${d}" fill="${color}"/></svg>`;
};
const trophy = ({ kind = 'cup', award, team, detail }) => `<li style="display: flex; align-items: center; gap: 16px; padding: 12px 0; list-style: none"><span style="display: grid; place-items: center; width: 80px; flex: none">${trophyPicto(kind, 3)}</span><div style="min-width: 0; display: flex; flex-direction: column; gap: 6px"><h3 style="margin: 0; ${px(16)}; overflow-wrap: anywhere; text-wrap: balance">${String(award).split(' (').join('&nbsp;(')}</h3><div style="font-size: 15px; text-wrap: pretty"><b style="font-weight: 600">${team}</b> <span style="color: {{t.dim}}">· ${nb(detail)}</span></div></div></li>`;

// ---- countdown (pre-draft) ----
const countdown = ({ days, hours, minutes, label = 'Draft starts in' }) => `<div role="group" aria-label="${label} ${days} days, ${hours} hours, ${minutes} minutes" style="display: inline-flex; gap: 12px">${[[days, 'days'], [hours, 'hours'], [minutes, 'minutes']].map(([n, u]) => `<div style="display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 96px; padding: 12px 8px; box-sizing: border-box; border: 2px solid {{t.frame}}; background: {{t.bg}}"><span aria-hidden="true" style="${px(32)}; line-height: 1.2">${String(n).padStart(2, '0')}</span><span style="font-size: 13px; color: {{t.dim}}">${u}</span></div>`).join('')}</div>`;

// ---- commissioner ----
// facts: [[label, value]]; items: [{ text, note, action, urgent }]. Never filled; red only when something is under an hour.
function commissioner({ facts = [], items, id = 'cm-h', phone = false }) {
  const pad = phone ? 14 : 20;
  const factRow = facts.length && !phone ? `<dl style="margin: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px 24px; padding: 14px 20px; border-bottom: 2px solid {{t.rule}}">${facts.map(([l, v]) => `<div><dt style="font-size: 13px; color: {{t.dim}}">${l}</dt><dd style="margin: 0; font-size: 15px; font-weight: 600">${v}</dd></div>`).join('')}</dl>` : '';
  const li = (it, i) => `<li style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; padding: ${it.text ? '12px 0' : '0'}; ${i ? 'border-top: 2px solid {{t.rule}}' : ''}">${it.text ? `<div style="min-width: 0"><div style="font-size: 15px; font-weight: 600; ${it.urgent ? 'color: {{t.danger}}; display: flex; align-items: center; gap: 8px' : ''}">${it.urgent ? clock('{{t.danger}}') : ''}${it.text}</div>${it.note ? `<div style="font-size: 14px; color: {{t.dim}}; max-width: 60ch; text-wrap: pretty">${it.note}</div>` : ''}</div>${it.action || ''}` : `<div style="margin-left: -10px">${it.action}</div>`}</li>`;
  return `<section aria-labelledby="${id}" style="${FRAME2}; min-width: 0">${frameHead(h2s(id, 'Commissioner'), { phone })}
${factRow}
<ul style="list-style: none; margin: 0; padding: 0 ${pad}px">${items.map(li).join('')}</ul></section>`;
}
// The pending-join-requests link as the product draws it: a link with a count badge, no button.
const joinRequestsLink = (n = 2) => `<a href="#" aria-label="Join requests, ${n} pending" style="display: inline-flex; align-items: center; gap: 10px; min-height: 44px; font-size: 15px; font-weight: 600; color: inherit; text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 5px; text-decoration-color: {{t.dim}}">Join requests ${k.badge(n, 'requests')}</a>`;

// ---- forms ----
const msg = (id, text, err) => `<div id="${id}" style="display: flex; align-items: flex-start; gap: 8px; font-size: 14px; color: ${err ? '{{t.ink}}' : '{{t.dim}}'}">${err ? warn('{{t.danger}}') : ''}<span>${text}</span></div>`;
const CTRL = (err, s, off) => `box-sizing: border-box; height: 44px; border-radius: 0; background: {{t.bg}}; color: ${off ? '{{t.dim}}' : '{{t.ink}}'}; border: 2px solid ${err ? '{{t.danger}}' : s === 'hover' || s === 'focus' ? '{{t.ink}}' : off ? '{{t.rule}}' : '{{t.dim}}'}; font-family: inherit; font-size: 16px; ${stateStyle(s)}`;
function field({ id, label, value = '', hint, error, placeholder, state, disabled, type = 'text', w }) {
  const d = hint || error ? id + '-d' : '';
  return `<div style="display: flex; flex-direction: column; gap: 6px; min-width: 0; ${w ? `width: ${w}px` : ''}"><label for="${id}" style="font-size: 14px; font-weight: 600">${label}</label><input id="${id}" type="${type}" value="${esc(value)}"${placeholder ? ` placeholder="${esc(placeholder)}"` : ''}${disabled ? ' disabled' : ''}${error ? ' aria-invalid="true"' : ''}${d ? ` aria-describedby="${d}"` : ''} style="${CTRL(error, state, disabled)}; padding: 0 12px; width: 100%; appearance: none">${error ? msg(d, error, true) : hint ? msg(d, hint) : ''}</div>`;
}
const caret = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M1 2h10v2H9v2H7v2H5V6H3V4H1z" fill="currentColor"/></svg>';
function select({ id, label, options, value, hint, error, state, disabled, w }) {
  const d = hint || error ? id + '-d' : '';
  return `<div style="display: flex; flex-direction: column; gap: 6px; min-width: 0; ${w ? `width: ${w}px` : ''}"><label for="${id}" style="font-size: 14px; font-weight: 600">${label}</label><div style="position: relative"><select id="${id}"${disabled ? ' disabled' : ''}${error ? ' aria-invalid="true"' : ''}${d ? ` aria-describedby="${d}"` : ''} style="${CTRL(error, state, disabled)}; padding: 0 56px 0 12px; width: 100%; appearance: none; opacity: 1">${options.map(o => `<option value="${esc(o.value ?? o)}"${(o.value ?? o) === value ? ' selected' : ''}>${o.label ?? o}</option>`).join('')}</select><span aria-hidden="true" style="position: absolute; right: 0; top: 0; width: 44px; height: 44px; display: grid; place-items: center; pointer-events: none; border-left: 2px solid ${disabled ? '{{t.rule}}' : '{{t.dim}}'}; box-sizing: border-box; color: ${disabled ? '{{t.dim}}' : '{{t.ink}}'}">${caret}</span></div>${error ? msg(d, error, true) : hint ? msg(d, hint) : ''}</div>`;
}
// Toggle: square 44x24 track, square pixel knob. The On/Off word is part of the control, so state never rides on colour alone.
const toggle = ({ id, label, on = false, disabled = false, state }) => `<label class="tg" style="${PBV}; display: inline-flex; align-items: center; gap: 12px; min-height: 44px; font-size: 15px; font-weight: 600; ${disabled ? 'color: {{t.dim}}; cursor: not-allowed' : 'cursor: pointer'}"><input id="${id}" class="sw" type="checkbox" role="switch"${on ? ' checked' : ''}${disabled ? ' disabled' : ''}><span class="tg-track" aria-hidden="true" style="${state === 'focus' ? FOCUS : ''}"><span class="tg-knob"></span></span><span>${label}</span><span class="tg-state" style="font-weight: 400; color: {{t.dim}}"></span></label>`;
const minus = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M1 5h10v2H1z" fill="currentColor"/></svg>';
const plus = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M5 1h2v4h4v2H7v4H5V7H1V5h4z" fill="currentColor"/></svg>';
function stepper({ id, label, value, state, disabled, atMin, atMax }) {
  const b = (aria, ic, off, s) => `<button type="button" aria-label="${aria}"${off ? ' disabled' : ''} style="width: 44px; height: 44px; padding: 0; display: grid; place-items: center; box-sizing: border-box; border-radius: 0; background: transparent; border: 2px ${off ? 'dashed {{t.rule}}' : 'solid {{t.ink}}'}; color: ${off ? '{{t.dim}}' : '{{t.ink}}'}; cursor: ${off ? 'not-allowed' : 'pointer'}">${ic}</button>`;
  return `<div style="display: flex; flex-direction: column; gap: 6px"><span id="${id}-l" style="font-size: 14px; font-weight: 600">${label}</span><div role="group" aria-labelledby="${id}-l" style="display: inline-flex">${b('Decrease ' + label, minus, disabled || atMin)}<input id="${id}" type="text" inputmode="numeric" value="${esc(value)}" aria-labelledby="${id}-l"${disabled ? ' disabled' : ''} style="${CTRL(false, state, disabled)}; width: 72px; padding: 0 8px; text-align: center; border-left: 0; border-right: 0; font-weight: 600">${b('Increase ' + label, plus, disabled || atMax)}</div></div>`;
}
// options: [{ value, label, desc, checked, disabled, state }]. Selected = Play-blue fill + filled dot, never colour alone.
const radioCards = ({ legend, name, options }) => `<fieldset style="${PBV}; border: 0; margin: 0; padding: 0; min-width: 0"><legend style="padding: 0; margin-bottom: 8px; font-size: 14px; font-weight: 600">${legend}</legend><div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 8px">${options.map((o, i) => `<label class="rc" style="display: block"><input class="sw" type="radio" name="${name}" value="${esc(o.value)}"${o.checked ? ' checked' : ''}${o.disabled ? ' disabled' : ''}><span class="rc-card" style="${stateStyle(o.state)}"><span class="rc-dot" aria-hidden="true"></span><span style="display: flex; flex-direction: column; gap: 2px"><span style="font-size: 15px; font-weight: 600">${o.label}</span>${o.desc ? `<span style="font-size: 14px; opacity: .85">${o.desc}</span>` : ''}</span></span></label>`).join('')}</div></fieldset>`;

// ---- overlays and navigation ----
// A modal: 6px double Frame on a Field scrim. Place inside a relative box, or pass fixed for the page.
function dialog({ id = 'dlg', title, body, actions, fixed = false }) {
  return `<div style="position: ${fixed ? 'fixed' : 'absolute'}; inset: 0; z-index: 10; display: grid; place-items: center; padding: 24px; box-sizing: border-box; background: {{t.scrim}}"><div role="dialog" aria-modal="true" aria-labelledby="${id}-t" style="${FRAME}; width: 100%; max-width: 480px; box-sizing: border-box"><div style="padding: 14px 20px; border-bottom: 2px solid {{t.rule}}"><h2 id="${id}-t" style="margin: 0; ${px(16)}">${title}</h2></div><div style="padding: 20px; font-size: 16px">${body}</div><div style="display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 12px; padding: 14px 20px; border-top: 2px solid {{t.rule}}">${actions}</div></div></div>`;
}
const menuButton = (label, { open = false } = {}) => `<button type="button" aria-haspopup="menu" aria-expanded="${open}" style="min-height: 44px; display: inline-flex; align-items: center; gap: 10px; padding: 0 16px; box-sizing: border-box; border-radius: 0; background: transparent; border: 2px solid {{t.ink}}; color: {{t.ink}}; font-family: inherit; font-size: 15px; font-weight: 600">${label}${caret}</button>`;
// items: [{ label, href, selected, disabled, state, sep }]
const menu = ({ label, items }) => `<ul role="menu" aria-label="${esc(label)}" style="${FRAME}; ${PBV}; list-style: none; margin: 0; padding: 6px; min-width: 240px; display: inline-block; box-sizing: border-box">${items.map(i => i.sep ? '<li role="separator" style="border-top: 2px solid {{t.rule}}; margin: 6px 0"></li>' : `<li role="none"><a role="menuitem${i.selected !== undefined ? 'radio' : ''}"${i.selected !== undefined ? ` aria-checked="${!!i.selected}"` : ''}${i.disabled ? ' aria-disabled="true"' : ` href="${i.href || '#'}"`} class="${i.disabled ? '' : 'pb'}" style="${i.state === 'hover' ? 'background: {{t.play}}; color: {{t.playInk}}' : ''}; ${i.state === 'focus' ? FOCUS + ';' : ''} display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 0 12px; box-sizing: border-box; font-size: 15px; font-weight: 600; text-decoration: none; color: ${i.disabled ? '{{t.dim}}' : i.state === 'hover' ? '{{t.playInk}}' : '{{t.ink}}'}; ${i.disabled ? 'cursor: not-allowed' : ''}"><span style="width: 12px; flex: none; display: inline-flex">${i.selected ? arrow() : ''}</span>${i.label}</a></li>`).join('')}</ul>`;
// items: [{ label, selected, count, disabled, state }]. Selected = Play-blue fill + arrow. Only where a page already has tabs.
const tabs = ({ label, items, id = 'tb' }) => `<div role="tablist" aria-label="${esc(label)}" style="${PBV}; display: flex; flex-wrap: wrap; gap: 4px; border-bottom: 2px solid {{t.rule}}">${items.map((t, i) => `<button type="button" role="tab" id="${id}-${i}" aria-selected="${!!t.selected}"${t.disabled ? ' disabled' : ''} class="${t.selected || t.disabled ? '' : 'pb'}" style="${t.state === 'hover' ? 'background: {{t.play}}; color: {{t.playInk}}; ' : ''}${t.state === 'focus' ? FOCUS + '; ' : ''}min-height: 44px; display: inline-flex; align-items: center; gap: 8px; padding: 0 16px; margin-bottom: -2px; box-sizing: border-box; border-radius: 0; font-family: inherit; font-size: 15px; font-weight: 600; background: ${t.selected ? '{{t.play}}' : 'transparent'}; color: ${t.selected ? '{{t.playInk}}' : t.disabled ? '{{t.dim}}' : '{{t.ink}}'}; border: 2px ${t.disabled ? 'dashed {{t.rule}}' : 'solid ' + (t.selected ? '{{t.play}}' : '{{t.rule}}')}; border-bottom: 2px solid ${t.selected ? '{{t.play}}' : '{{t.rule}}'}; ${t.disabled ? 'cursor: not-allowed' : ''}">${t.selected ? arrow() : ''}${t.label}${t.count !== undefined ? `<span style="font-weight: 400; opacity: .85">${t.count}</span>` : ''}</button>`).join('')}</div>`;

// ---- chat ----
const speech = '<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" shape-rendering="crispEdges"><path d="M2 2h20v2H2zM2 4h2v12H2zM20 4h2v12h-2zM2 16h20v2H2zM6 18h2v2H6zM4 20h2v2H4zM7 7h10v2H7zM7 11h6v2H7z" fill="currentColor"/></svg>';
const chatButton = ({ unread = 0 } = {}) => `<button type="button" aria-label="${unread ? `Open league chat, ${unread} unread messages` : 'Open league chat'}" style="position: relative; display: grid; place-items: center; width: 56px; height: 56px; padding: 0; box-sizing: border-box; border-radius: 0; background: {{t.panel}}; border: 2px solid {{t.ink}}; color: {{t.ink}}">${speech}${unread ? `<span aria-hidden="true" style="position: absolute; top: -14px; right: -14px; display: grid; place-items: center; min-width: 28px; height: 28px; padding: 0 4px; box-sizing: border-box; background: {{t.bg}}; border: 2px solid {{t.ink}}; ${px(16)}; line-height: 1">${unread}</span>` : ''}</button>`;
// messages: [{ team, time, text, you }]. Desktop docks 380px; phone is full width.
function chatDrawer({ messages, phone = false, id = 'chat-h' }) {
  return `<aside role="dialog" aria-labelledby="${id}" style="${FRAME}; display: flex; flex-direction: column; box-sizing: border-box; width: ${phone ? '100%' : '380px'}; max-width: 100%">${frameHead(`<h2 id="${id}" style="margin: 0; ${px(16)}">League Chat</h2><button type="button" aria-label="Close chat" style="margin-left: auto; width: 44px; height: 44px; padding: 0; display: grid; place-items: center; box-sizing: border-box; border-radius: 0; background: transparent; border: 2px solid {{t.ink}}; color: {{t.ink}}"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M1 1h2v2H1zM3 3h2v2H3zM5 5h2v2H5zM7 7h2v2H7zM9 9h2v2H9zM9 1h2v2H9zM7 3h2v2H7zM3 7h2v2H3zM1 9h2v2H1z" fill="currentColor"/></svg></button>`, { phone })}
<ul role="log" aria-label="Messages" style="list-style: none; margin: 0; padding: 12px 16px; display: flex; flex-direction: column; gap: 14px; flex: 1">${messages.map(m => `<li style="padding-left: 12px; border-left: 4px solid ${m.you ? '{{t.play}}' : '{{t.rule}}'}"><div style="display: flex; gap: 8px; align-items: baseline"><b style="font-size: 14px; font-weight: 600">${m.team}</b><span style="font-size: 13px; color: {{t.dim}}">${m.time}</span></div><div style="font-size: 15px">${m.text}</div></li>`).join('')}</ul>
<form style="display: flex; gap: 8px; padding: 12px 16px; border-top: 2px solid {{t.rule}}"><label for="${id}-m" style="${SR}">Message</label><input id="${id}-m" type="text" placeholder="Message" style="${CTRL(false)}; flex: 1; min-width: 0; padding: 0 12px"><button type="submit" style="min-height: 44px; padding: 0 16px; box-sizing: border-box; border-radius: 0; background: transparent; border: 2px solid {{t.ink}}; color: {{t.ink}}; font-size: 15px; font-weight: 600">Send</button></form></aside>`;
}

// ---- activity ----
// Kind tags are the product's: Add, Drop, Trade, Waiver, Settings, Stat correction, Recap. Archivo 13 700, never Pixel.
const rowTag = (text, { full = false } = {}) => `<span style="display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; ${full ? 'width: 100%' : 'min-width: 72px'}; min-height: 28px; padding: 4px 8px; border: 2px solid {{t.rule}}; color: {{t.ink}}; font-size: 13px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; line-height: 1.2; text-align: center; white-space: nowrap; flex: none">${text}</span>`;
const activityRow = ({ kind, team, text, time, last = false, phone = false }) => {
  const sentence = `${team ? `<b style="font-weight: 600">${team}</b> ` : ''}${text}`, bd = last ? '' : 'border-bottom: 2px solid {{t.rule}}';
  return phone
    ? `<li style="display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; box-sizing: border-box; padding: 10px 0; ${bd}">${rowTag(kind)}<span style="margin-left: auto; font-size: 13px; color: {{t.dim}}; white-space: nowrap">${time}</span><div style="width: 100%; font-size: 15px; text-wrap: pretty">${sentence}</div></li>`
    : `<li style="display: flex; align-items: flex-start; gap: 12px; min-height: 44px; box-sizing: border-box; padding: 8px 0; ${bd}"><span style="flex: none; width: 160px; display: flex">${rowTag(kind, { full: true })}</span><div style="flex: 1; min-width: 0; font-size: 15px; padding-top: 2px; text-wrap: pretty">${sentence}</div><span style="flex: none; font-size: 13px; color: {{t.dim}}; padding-top: 5px; white-space: nowrap">${time}</span></li>`;
};

module.exports = {
  ...k, meta, nb, chip, rowTag, joinRequestsLink, TOKENS, page, force, FOCUS, btnDisabled, posTag, gradeChip, kindTag, youBadge, avatar, liveChipBoard, cursorRow, breadcrumb,
  table, standings, versusPanel, versusLive, myTeam, recapPanel, aroundTile, aroundMore, leaguePicto, playbookTile, playbook,
  trophyPicto, trophy, countdown, commissioner, field, select, toggle, stepper, radioCards, dialog, menuButton, menu, tabs, chatButton, chatDrawer, activityRow,
};

// ---- matchup / lineup / states additions (append-only) ----
const lockIcon = (color = 'currentColor') => `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" shape-rendering="crispEdges" style="flex: none"><path d="M5 1h6v2H5zM3 3h2v4H3zM11 3h2v4h-2zM2 7h12v8H2zM7 9h2v3H7z" fill="${color}" fill-rule="evenodd"/></svg>`;
const checkIcon = (color = 'currentColor') => `<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" shape-rendering="crispEdges" style="flex: none"><path d="M1 6h2v2H1zM3 8h2v2H3zM5 6h2v2H5zM7 4h2v2H7zM9 2h2v2H9z" fill="${color}"/></svg>`;
// Injury as a word tag (Lineup rows): Out is inverted ink so it stands out without using red.
const injTag = word => `<span style="display: inline-flex; align-items: center; box-sizing: border-box; height: 22px; padding: 0 6px; border: 2px solid currentColor; ${word === 'Out' ? 'background: {{t.ink}}; color: {{t.bg}}; border-color: {{t.ink}}; ' : ''}font-size: 13px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; line-height: 1; flex: none">${word}</span>`;
const viewToggle = ({ label, items }) => `<div role="group" aria-label="${esc(label)}" style="display: inline-flex">${items.map((t, i) => `<button type="button" aria-pressed="${!!t.selected}" style="min-height: 44px; display: inline-flex; align-items: center; gap: 8px; padding: 0 16px; box-sizing: border-box; border-radius: 0; font-family: inherit; font-size: 15px; font-weight: 600; border: 2px solid ${t.selected ? '{{t.play}}' : '{{t.ink}}'}; ${i ? 'margin-left: -2px; ' : ''}background: ${t.selected ? '{{t.play}}' : 'transparent'}; color: ${t.selected ? '{{t.playInk}}' : '{{t.ink}}'}">${t.selected ? arrow() : ''}${t.label}</button>`).join('')}</div>`;
// Floor, projection, ceiling: a band from floor to ceiling with a tick at the projection.
const rangeBar = ({ floor, proj, ceil, max = 30 }) => {
  const p = v => (v / max * 100).toFixed(1) + '%';
  const cell = (l, v, al) => `<span style="text-align: ${al}">${l}<br><b style="font-size: 14px; font-weight: 600; color: {{t.ink}}">${Number(v).toFixed(1)}</b></span>`;
  return `<div role="img" aria-label="Floor ${floor}, projection ${proj}, ceiling ${ceil}" style="display: flex; flex-direction: column; gap: 6px"><div aria-hidden="true" style="position: relative; height: 16px; box-sizing: border-box; border: 2px solid {{t.rule}}"><span style="position: absolute; top: 2px; bottom: 2px; left: ${p(floor)}; width: calc(${p(ceil)} - ${p(floor)}); background: {{t.play}}"></span><span style="position: absolute; top: -6px; bottom: -6px; left: ${p(proj)}; width: 4px; margin-left: -4px; box-sizing: content-box; background: {{t.ink}}; border: 2px solid {{t.panel}}"></span></div><div aria-hidden="true" style="display: grid; grid-template-columns: repeat(3, 1fr); font-size: 13px; line-height: 1.3; color: {{t.dim}}">${cell('Floor', floor, 'left')}${cell('Proj', proj, 'center')}${cell('Ceiling', ceil, 'right')}</div></div>`;
};
// One ledger row. mode: 'normal' | 'moving' (the cursor, selected) | 'eligible' (Play-blue) | 'dim' (ineligible while a move is picked).
// cursor: the row wears the one cursor frame. action: html for the right cell (the page's one filled action goes here, never on a locked row).
function lineupRow({ slot, name, inj, sub, game, detail, proj, pts, lock = false, empty = false, cursor = false, action = '', mode = 'normal', phone = false, last = false, note = '' }) {
  const hi = mode === 'eligible', cur = cursor || mode === 'moving';
  const dm = hi ? '{{t.playDim}}' : '{{t.dim}}';
  const lbl = `<span style="flex: none; width: ${phone ? 50 : 52}px; font-size: 13px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase">${slot}</span>`;
  const who = empty
    ? `<span style="font-size: 15px; color: ${dm}">Empty</span>`
    : `<div style="min-width: 0"><div style="display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px"><span style="font-size: 15px; font-weight: 600">${name}</span>${inj ? injTag(inj) : ''}${lock ? `<span style="display: inline-flex; align-items: center">${lockIcon()}<span style="${SR}">Locked: this player's game has kicked off</span></span>` : ''}</div><div style="font-size: 13px; color: ${dm}">${sub}${phone && game ? ` · ${game}` : ''}</div></div>`;
  const fig = empty ? '' : `<div style="text-align: right; flex: none"><div style="font-size: 16px; font-weight: 700">${pts != null ? pts : '-'}</div><div style="font-size: 13px; color: ${dm}">${proj} proj</div></div>`;
  const inner = phone
    ? `<div style="display: flex; align-items: center; gap: 8px; min-height: 52px">${lbl}<div style="flex: 1; min-width: 0">${who}</div>${fig}</div>`
    : `<div style="display: grid; grid-template-columns: 52px minmax(0, 1.25fr) minmax(0, 1fr) 84px 140px; align-items: center; gap: 12px; min-height: 52px">${lbl}${who}<div style="min-width: 0">${empty || !game ? '' : `<div style="font-size: 14px; font-weight: 600">${game}</div><div style="font-size: 13px; color: ${dm}">${detail || ''}</div>`}</div>${fig || '<span></span>'}<div style="display: flex; justify-content: flex-end; align-items: center">${action}</div></div>`;
  const border = cur ? '{{t.cursor}}' : 'transparent';
  const body = `<div class="${cur ? 'cursor ' : ''}slot" style="--cur: {{t.cursor}}; --dm: ${dm}; padding: 0 ${phone ? 6 : 8}px; border: 4px solid ${border}; box-sizing: border-box; ${hi ? 'background: {{t.play}}; color: {{t.playInk}}; ' : ''}${mode === 'dim' ? 'opacity: .5' : ''}">${inner}</div>`;
  return `<li style="${last ? '' : 'border-bottom: 2px solid {{t.rule}}'}">${body}</li>`;
}
Object.assign(module.exports, { lockIcon, checkIcon, injTag, viewToggle, rangeBar, lineupRow });

// ---- dashboard phases builder (PreDraft, Drafting, Complete, PickemOnly): appended pieces ----
// Head pattern for every dashboard: pixel h1; one chip row (phase chip, then team count / Draft Complete, then the live chip); one dim line, "Times in CDT".
// chips: strings (or legacy [text, strong] pairs: strong is ignored, all chips are neutral). live: text for the live chip on game day.
const phHead = ({ title, chips = [], live, status = 'Times in CDT', right, phone = false }) => `<section aria-labelledby="h1" style="display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 16px 24px"><div style="display: flex; flex-direction: column; gap: 12px; min-width: 0">${k.h1(title, { phone })}<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px">${chips.map(c => chip(Array.isArray(c) ? c[0] : c)).join('')}${live ? k.liveChip(live) : ''}<p style="margin: 0; font-size: 17px; color: {{t.dim}}; text-wrap: pretty">${status}</p></div></div>${right ? `<div>${right}</div>` : ''}</section>`;
const phTeamCell = (team, me) => { const c = me ? '{{t.playInk}}' : '{{t.ink}}'; return `<span style="display: flex; align-items: center; gap: 10px"><span aria-hidden="true" style="width: 12px; flex: none; display: inline-flex">${me ? arrow() : ''}</span>${avatar(team, { c })}<a href="#" style="display: flex; align-items: center; min-height: 44px; font-size: 15px; font-weight: 600; color: inherit; text-decoration: none">${team}</a>${me ? youBadge(c) : ''}</span>`; };
// Preseason standings: placeholder marks, no cut line, the "populate after Week 1" note (StandingsTable.jsx preseason state).
function phPreseasonStandings({ teams, viewer, title = 'Standings', id = 'st-h' }) {
  const ph = '<span aria-hidden="true">-</span><span style="' + SR + '">No data yet</span>';
  const cols = [{ label: 'Rank', w: 64 }, { label: 'Team', w: 300 }, { label: 'W-L-T', align: 'right', w: 88 }, { label: 'PF', align: 'right', w: 88 }, { label: 'PA', align: 'right', w: 88 }, { label: 'STRK', align: 'right', w: 72 }];
  const rows = teams.map((t, i) => [i + 1, phTeamCell(t, i === viewer), ph, ph, ph, ph]);
  return `<section aria-labelledby="${id}" style="${FRAME}; min-width: 0">${frameHead(`${h2(id, title)}${meta(`${teams.length} teams`, 'margin-left: auto')}`)}${table({ label: `${title}, ${teams.length} teams`, cols, rows, viewer, minW: 700 })}<p style="margin: 0; padding: 14px 20px; border-top: 2px solid {{t.rule}}; font-size: 14px; color: {{t.dim}}">Records, points and streaks populate after Week 1.</p></section>`;
}
const phEmpty = ({ id, title, count, text, tail, small = false, center = false }) => `<section aria-labelledby="${id}" style="${small ? FRAME2 : FRAME}; display: flex; flex-direction: column; box-sizing: border-box; min-width: 0">${frameHead(`${small ? `<h2 id="${id}" style="margin: 0; ${px(16)}">${title}</h2>` : h2(id, title)}${count !== undefined ? meta(count + ' moves') : ''}${tail ? `<span style="margin-left: auto">${tail}</span>` : ''}`)}<p style="margin: 0; padding: 20px; flex: 1; ${center ? 'display: flex; align-items: center; ' : ''}font-size: 16px; color: {{t.dim}}">${text}</p></section>`;
// Playbook with one more pictogram (Draft Settings); same tile as playbookTile.
const phPb = (() => {
  const Hh = (x1, x2, y) => 'M' + x1 + ' ' + y + 'h' + (x2 - x1) + 'v2h' + (x1 - x2) + 'z';
  const knob = (x, y) => 'M' + x + ' ' + (y - 5) + 'h8v12h-8z';
  const settings = Hh(10, 86, 12) + Hh(10, 86, 24) + Hh(10, 86, 36) + knob(56, 12) + knob(26, 24) + knob(64, 36);
  const svg = d => `<svg width="96" height="48" viewBox="0 0 96 48" aria-hidden="true" shape-rendering="crispEdges" style="display: block; flex: none"><path d="${d}" fill="{{t.playInk}}"/></svg>`;
  const tile = ({ kind, label, status }) => `<a href="#" style="display: flex; align-items: center; gap: 14px; min-height: 44px; padding: 12px 14px; box-sizing: border-box; background: {{t.play}}; border: 2px solid {{t.playInk}}; color: {{t.playInk}}; text-decoration: none">${kind === 'settings' ? svg(settings) : leaguePicto(kind)}<span style="display: flex; flex-direction: column; gap: 2px; min-width: 0"><span style="font-size: 15px; font-weight: 600">${label}</span><span style="font-size: 14px; color: {{t.playDim}}">${status}</span></span></a>`;
  return ({ groups, id = 'pb-h', cols = 300, tail = 'Everything else in this league' }) => `<section aria-labelledby="${id}" style="${FRAME2}; min-width: 0">${frameHead(`${h2s(id, 'Playbook')}${meta(tail, 'margin-left: auto')}`)}<div style="padding: 20px; display: grid; grid-template-columns: repeat(auto-fit, minmax(${cols}px, 1fr)); gap: 24px">${groups.map(g => `<div style="display: flex; flex-direction: column; gap: 10px; min-width: 0"><h3 style="margin: 0; font-size: 13px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: {{t.dim}}">${g.name} · ${g.tiles.length}</h3>${groups.length === 1 ? `<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(${cols}px, 1fr)); gap: 10px">${g.tiles.map(tile).join('')}</div>` : g.tiles.map(tile).join('')}</div>`).join('')}</div></section>`;
})();
Object.assign(module.exports, { phHead, phTeamCell, phPreseasonStandings, phEmpty, phPb });

// My team before the season has a record: only the tiles that have a value (research: Draft grade, Proj. finish, Playoff odds, Roster value drop out).
const phMyTeam = ({ name, tiles = [], status, id = 'mt-h' }) => `<section aria-labelledby="${id}" style="${FRAME}; display: flex; flex-direction: column; box-sizing: border-box; min-width: 0">${frameHead(`${h2(id, name)}${youBadge()}`)}
<div style="padding: 20px; display: flex; flex-direction: column; gap: 16px; flex: 1"><div style="display: flex; flex-wrap: wrap; gap: 12px 28px">${tiles.map(([l, v]) => `<div style="display: flex; flex-direction: column; gap: 2px"><span style="font-size: 13px; color: {{t.dim}}">${l}</span><span style="font-size: 16px; font-weight: 600">${v}</span></div>`).join('')}</div>
<div style="margin-top: auto; font-size: 15px; font-weight: 600">${status}</div></div>
<nav aria-label="${esc(name)}" style="display: flex; flex-wrap: wrap; padding: 4px 6px; border-top: 2px solid {{t.rule}}">${['Lineup', 'Waivers', 'Trades'].map(l => link(l, `${name} ${l.toLowerCase()}`)).join('')}</nav></section>`;
// One invite code everywhere.
const INVITE_CODE = 'TNR-7K4Q';
const inviteButton = (code = INVITE_CODE) => btnGhost(`Invite <span style="font-weight: 600; letter-spacing: .08em; font-variant-numeric: tabular-nums">${code}</span>`, { aria: `Copy invite link, code ${code}` });
Object.assign(module.exports, { phMyTeam, INVITE_CODE, inviteButton });

// ---- My team, full width (game day): record, PF, PA and the next lock on the left, five starters on the right ----
function myTeamWide({ name, record, rankLine, pf, pa, nextLock, lockNote, starters, more, status, id = 'mt-h', live = false, fix = false }) {
  const stat = (l, v) => `<div style="display: flex; flex-direction: column; gap: 2px"><span style="font-size: 13px; color: {{t.dim}}">${l}</span><span style="font-size: 16px; font-weight: 600">${v}</span></div>`;
  const rows = starters.map((s, i) => `<li style="display: flex; align-items: center; gap: 12px; min-height: 44px; ${i < starters.length - 1 ? 'border-bottom: 2px solid {{t.rule}}' : ''}">${posTag(s.slot)}<div style="flex: 1; min-width: 0"><div style="display: flex; align-items: center; gap: 8px"><span style="font-size: 15px; font-weight: 600">${s.name}</span>${s.inj ? injury(s.inj) : ''}</div><div style="font-size: 13px; color: {{t.dim}}">${s.game}</div></div>${figCols(s, live)}</li>`).join('');
  return `<section aria-labelledby="${id}" style="${FRAME}; display: flex; flex-direction: column; min-width: 0">${frameHead(`${h2(id, name)}${youBadge()}${meta(rankLine, 'margin-left: auto')}`)}
<div style="padding: 20px; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr); gap: 32px; align-items: start">
<div style="display: flex; flex-direction: column; gap: 20px"><div><div style="font-size: 13px; color: {{t.dim}}">Record</div><div style="${px(24)}; line-height: 1.3">${record}</div></div><div style="display: flex; flex-wrap: wrap; gap: 12px 28px">${stat('Points for', pf)}${stat('Points against', pa)}</div>${statusRow(status, name, fix)}</div>
<div>${startersHead(live)}<ul style="list-style: none; margin: 0; padding: 0">${rows}</ul><p style="margin: 8px 0 0; font-size: 14px; color: {{t.dim}}">${more}</p></div>
</div>
<nav aria-label="${esc(name)}" style="display: flex; flex-wrap: wrap; padding: 4px 6px; border-top: 2px solid {{t.rule}}">${['Lineup', 'Waivers', 'Trades'].map(l => link(l, `${name} ${l.toLowerCase()}`)).join('')}</nav></section>`;
}
Object.assign(module.exports, { myTeamWide });

// ---- container tiers (critique pass) ----
// Mid-season trophy room: one link row instead of a frame.
const trophyLink = n => `<a href="#" aria-label="Trophy case, ${n} awards this season" style="${FRAME2}; display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 44px; padding: 8px 20px; box-sizing: border-box; color: inherit; font-size: 15px; font-weight: 600; text-decoration: none"><span>Trophy case · ${n} awards this season</span>${arrow()}</a>`;
Object.assign(module.exports, { FRAME2, h2s, trophyLink, liveStamp });
