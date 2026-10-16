// Wave 3 Trades pieces (head, segmented tabs, trade card, analysis, propose dialog, alerts, toasts) and the fixture's players and analysis numbers.
// Own file so parallel builders never collide. Product truth: src/components/TradeCenter (TradeCenter.jsx, TradeProposalCard.jsx), server/services/decision.service.js (analyzeTrade, fitAdjustedValue, tradeVerdict).
const k = require('./league-kit-samples');
const W7 = require('./week7-games');
const D = require('./lineup-data');
const { px, SR, esc, FRAME, FRAME2, h2s, frameHead, chip, avatar, youBadge, posTag, btnGhost, btnFill, warn, arrow, checkIcon, clock } = k;

const LG = 'Thursday Night Regulars';
const VIEWER = 'Darkness Falls';

// ---- players: rest-of-season value (ROS) and this week's projection, as GET /api/league/:id/rosters sends them ----
const ROS = {
  'Josh Allen': 243.1, 'Jahmyr Gibbs': 215.6, 'Woody Marks': 129.8, 'Puka Nacua': 188.8, "Ja'Marr Chase": 185.9, 'Trey McBride': 97.9, 'Brandon Aubrey': 89.1, Broncos: 70.4,
  'Tyjae Spears': 141.9, 'Jordan Addison': 112, 'Dalton Kincaid': 81.4, 'Tank Bigsby': 68, 'Tyler Allgeier': 64, 'Chris Olave': 133.1, 'Rome Odunze': 60,
};
const mk = (name, pos, nfl, wk, ros) => ({ name, pos, nfl, wk, ros: ros ?? ROS[name] });
// Darkness Falls' roster is lineup-data.js (starters, bench, IR); the FLEX slot is empty so it adds no player.
const DF = [...D.STARTERS.filter(s => !s.empty), ...D.BENCH, ...D.IR].map(s => { const [pos, nfl] = s.sub.split(' · '); return mk(s.name, pos, nfl, +s.proj); });
const df = n => DF.find(p => p.name === n) || (() => { throw new Error('no DF player ' + n); })();
const WILSON = mk('Garrett Wilson', 'WR', 'NYJ', 13.7, 150), FLOWERS = mk('Zay Flowers', 'WR', 'BAL', 0, 134), WHITE = mk('Rachaad White', 'RB', 'TB', 11.4, 125.4), WADDLE = mk('Jaylen Waddle', 'WR', 'MIA', 12.2, 134.2);
const BROWN = mk('Chase Brown', 'RB', 'CIN', 14.8, 162.8), SUTTON = mk('Courtland Sutton', 'WR', 'DEN', 12.4, 136.4);
const DADS = [
  mk('Caleb Williams', 'QB', 'CHI', 17.4, 191.4),
  mk('Breece Hall', 'RB', 'NYJ', 14.2, 156.2), mk('Kenneth Walker III', 'RB', 'SEA', 13.1, 144.1), mk('Jonathan Taylor', 'RB', 'IND', 15.0, 165.0),
  mk('Malik Nabers', 'WR', 'NYG', 15.1, 166), mk('Marvin Harrison Jr.', 'WR', 'ARI', 10.8, 118.8), mk('Ladd McConkey', 'WR', 'LAC', 0, 127.6), mk('Brian Thomas Jr.', 'WR', 'JAX', 12.5, 137.5),
  mk('Brock Bowers', 'TE', 'LV', 12.3, 135.3), mk('Cameron Dicker', 'K', 'LAC', 0, 92.4), mk('Texans', 'DEF', 'HOU', 7.0, 77.0),
];
const dads = n => DADS.find(p => p.name === n) || (() => { throw new Error('no Dads player ' + n); })();
// Positions on the other rosters the analysis reads for roster fit.
const GHOSTS_POS = ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'WR', 'TE', 'K', 'DEF'];
const WOLVES_POS = ['QB', 'RB', 'RB', 'RB', 'WR', 'WR', 'WR', 'WR', 'TE', 'K', 'DEF'];
const posOf = r => r.map(p => p.pos || p);

// ---- the analysis, as decision.service.js computes it ----
// Slots QB 1, RB 2, WR 2, TE 1, FLEX 1 (RB, WR, TE), K 1, DEF 1: a position's capacity = its dedicated slots + FLEX when eligible.
const CAP = { QB: 1, RB: 3, WR: 3, TE: 2, K: 1, DEF: 1 };
const r2 = x => Math.round((x + Number.EPSILON) * 100) / 100;
const FACTOR = (pos, rosterPos) => { const filling = rosterPos.filter(p => p === pos).length; return filling === 0 ? 1.15 : filling >= CAP[pos] ? 0.85 : 1; };
const fitValue = (p, rosterPos) => r2(p.ros * FACTOR(p.pos, rosterPos));
// proposerSends: [player] the proposer gives (valued on the receiving roster); receiverSends: the reverse.
function analyze(proposerSends, receiverSends, proposerPos, receiverPos) {
  const rows = [
    ...proposerSends.map(p => ({ ...p, fit: fitValue(p, receiverPos) })),
    ...receiverSends.map(p => ({ ...p, fit: fitValue(p, proposerPos) })),
  ];
  const proposerGives = r2(rows.slice(0, proposerSends.length).reduce((s, p) => s + p.fit, 0));
  const receiverGives = r2(rows.slice(proposerSends.length).reduce((s, p) => s + p.fit, 0));
  const proposerGets = receiverGives, receiverGets = proposerGives;
  const larger = Math.max(proposerGets, receiverGets), diff = Math.abs(proposerGets - receiverGets);
  const off = proposerSends.reduce((s, p) => s + p.ros, 0), req = receiverSends.reduce((s, p) => s + p.ros, 0);
  const margin = Math.max(off, req) === 0 ? 0 : Math.abs(off - req) / Math.max(off, req) * 100;
  const verdict = margin > 50 ? 'collusion_risk' : larger === 0 || diff <= larger * 0.1 ? 'fair' : proposerGets > receiverGets ? 'favors_proposer' : 'favors_receiver';
  return { verdict, proposerGives, proposerGets, receiverGives, receiverGets, rows };
}
const VERDICT = { fair: 'Fair', favors_proposer: 'Favors Proposer', favors_receiver: 'Favors Receiver', collusion_risk: 'Collusion risk' };
const fmt1 = v => (v == null ? '-' : Number(v).toFixed(1));
const oppLabel = nfl => { const g = W7.gameOf(nfl); return g ? 'vs ' + (g.away === nfl ? g.home : g.away) : 'Bye'; };

// ---- small pieces ----
const nameLink = (n, extra = '') => `<a href="#" style="display: inline-flex; align-items: center; min-height: 44px; font-size: 15px; font-weight: 600; color: inherit; text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 5px; text-decoration-color: {{t.dim}}; ${extra}">${n}</a>`;
const btnOff = label => `<button type="button" disabled style="min-height: 44px; display: inline-flex; align-items: center; padding: 0 16px; box-sizing: border-box; border-radius: 0; font-family: inherit; font-size: 15px; font-weight: 600; background: transparent; border: 2px solid {{t.rule}}; color: {{t.dim}}; cursor: not-allowed">${label}</button>`;
const leftArrow = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" style="flex: none"><path d="M9 1H7v2H5v2H3v2h2v2h2v2h2z" fill="currentColor"/></svg>';
const SUBLINE = 'Trade deadline Week 10 · times in CDT';

// Head: the product's back button (the league name), pixel h1, the sub-line, "Propose Trade" on the right (ghost: no filled action outside a modal).
function trHead({ phone = false, sub = SUBLINE } = {}) {
  const back = `<a href="#" aria-label="Back to ${LG}" style="min-height: 44px; display: inline-flex; align-items: center; gap: 8px; margin-left: -10px; padding: 0 10px; font-size: 15px; font-weight: 600; color: {{t.ink}}; text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 5px; text-decoration-color: {{t.dim}}; align-self: flex-start">${leftArrow}${LG}</a>`;
  return `<section aria-labelledby="h1" style="display: flex; flex-direction: column; gap: 4px; min-width: 0">${back}<div style="display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 12px 24px"><div style="display: flex; flex-direction: column; gap: 12px; min-width: 0">${k.h1('Trade Center', { phone })}<p style="margin: 0; font-size: ${phone ? 16 : 17}px; color: {{t.dim}}; text-wrap: pretty">${sub}</p></div>${btnGhost('Propose Trade')}</div></section>`;
}

// Tabs: the product's MUI Tabs in the Play-select segmented look (selected = Play-blue fill, arrow and the word). A tablist with roving tabindex.
const trTabs = ({ selected = 0, phone = false } = {}) => `<div role="tablist" aria-label="Trade Center sections" style="display: ${phone ? 'flex' : 'inline-flex'}">${['Pending', 'Completed', 'Trade Block'].map((t, i) => { const on = i === selected; return `<button type="button" role="tab" id="tr-tab-${i}" aria-selected="${on}" aria-controls="tr-panel" tabindex="${on ? 0 : -1}" style="min-height: 44px; ${phone ? 'flex: 1; ' : 'min-width: 140px; '}display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 0 ${phone ? 8 : 16}px; box-sizing: border-box; border-radius: 0; font-family: inherit; font-size: 15px; font-weight: 600; ${i ? 'margin-left: -2px; ' : ''}border: 2px solid ${on ? '{{t.play}}' : '{{t.ink}}'}; background: ${on ? '{{t.play}}' : 'transparent'}; color: ${on ? '{{t.playInk}}' : '{{t.ink}}'}">${on ? arrow() : ''}${t}</button>`; }).join('')}</div>`;

// ---- the trade card ----
const playerRow = (p, last) => `<li style="display: flex; align-items: center; gap: 10px; min-height: 44px; ${last ? '' : 'border-bottom: 2px solid {{t.rule}}'}">${posTag(p.pos)}<span style="flex: 1; min-width: 0">${nameLink(p.name)}</span><span style="font-size: 14px; color: {{t.dim}}; white-space: nowrap">${oppLabel(p.nfl)}</span></li>`;
const column = (label, items, id) => `<div style="min-width: 0"><h3 id="${id}" style="margin: 0 0 4px; font-size: 15px; font-weight: 700">${label}</h3><ul aria-labelledby="${id}" style="list-style: none; margin: 0; padding: 0">${items.map((p, i) => playerRow(p, i === items.length - 1)).join('')}</ul></div>`;

// result: analyze() output. gives/gets lines and per-player "ROS -> fit" rows, the product's strings.
function analysisResult(res, { phone = false } = {}) {
  const line = (who, g, t) => `<div style="font-size: 15px"><b style="font-weight: 600">${who}:</b> gives ${fmt1(g)} · gets ${fmt1(t)}</div>`;
  const row = (p, i, n) => `<li style="display: flex; align-items: center; gap: 10px; min-height: 44px; ${i < n - 1 ? 'border-bottom: 2px solid {{t.rule}}' : ''}">${posTag(p.pos)}<span style="flex: 1; min-width: 0">${nameLink(p.name)}</span><span style="display: inline-flex; align-items: center; gap: 8px; font-size: 15px; font-variant-numeric: tabular-nums; white-space: nowrap" aria-label="rest-of-season value ${fmt1(p.ros)}, adjusted for roster fit ${fmt1(p.fit)}"><span aria-hidden="true">${fmt1(p.ros)}</span><span aria-hidden="true" style="display: inline-flex">${arrow()}</span><b aria-hidden="true" style="font-weight: 700">${fmt1(p.fit)}</b></span></li>`;
  return `<div style="display: flex; flex-direction: column; gap: 12px"><div>${chip(VERDICT[res.verdict])}</div><div style="display: grid; grid-template-columns: ${phone ? '1fr' : 'repeat(2, minmax(0, 1fr))'}; gap: 4px 24px">${line('Proposer', res.proposerGives, res.proposerGets)}${line('Receiver', res.receiverGives, res.receiverGets)}</div><ul aria-label="Player values" style="list-style: none; margin: 0; padding: 0; border-top: 2px solid {{t.rule}}">${res.rows.map((p, i) => row(p, i, res.rows.length)).join('')}</ul></div>`;
}
const analyzing = () => `<p role="status" style="margin: 0; font-size: 15px; color: {{t.dim}}">Analyzing…</p>`;

// Trade card: tertiary frame, optional cursor frame (4px, the one cursor). Actions are ghost buttons; "Analyze Trade" is always the last button of the footer row; the commissioner's controls are their own row.
// left/right: [{ name, pos, nfl }]. you: the viewer's team name (the You badge follows that side's name). analysis: html result above the footer.
function tradeCard({ id, a, b, age, status, you, leftLabel, left, rightLabel, right, review, analysis = '', analyzingNow = false, actions = [], commish = false, cursor = false, phone = false }) {
  const pad = phone ? 14 : 20;
  // Each side is one nowrap unit (avatar, name, You badge) so a narrow card breaks between sides, never inside one.
  const side = (n, arrowAfter) => `<span style="display: inline-flex; align-items: center; gap: 8px; white-space: nowrap">${avatar(n)}<span>${n}</span>${you === n ? youBadge() : ''}${arrowAfter ? '<span aria-hidden="true" style="font-weight: 400; color: {{t.dim}}">\u21c4</span><span style="' + SR + '">to</span>' : ''}</span>`;
  const head = `<div style="display: flex; flex-wrap: nowrap; align-items: flex-start; justify-content: space-between; gap: 8px 16px; padding: ${pad - 4}px ${pad}px 12px"><div style="display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1"><h2 id="${id}-h" style="margin: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; font-size: 17px; font-weight: 700; line-height: 1.3">${side(a, true)}${side(b)}</h2><div style="display: flex; flex-wrap: wrap; align-items: center; gap: 2px 14px; font-size: 14px; color: {{t.dim}}"><span>${age}</span>${review ? `<span style="display: inline-flex; align-items: center; gap: 8px; color: {{t.ink}}; font-weight: 600">${clock('currentColor')}League review ends ${review}</span>` : ''}</div></div>${chip(status)}</div>`;
  const cols = `<div style="display: grid; grid-template-columns: ${phone ? '1fr' : 'minmax(0, 1fr) minmax(0, 1fr)'}; gap: ${phone ? 12 : 0}px; padding: 4px ${pad}px 12px"><div style="${phone ? '' : 'padding-right: 24px'}">${column(leftLabel, left, id + '-l')}</div><div style="${phone ? 'border-top: 2px solid {{t.rule}}; padding-top: 12px' : 'padding-left: 24px; border-left: 2px solid {{t.rule}}'}">${column(rightLabel, right, id + '-r')}</div></div>`;
  const an = analysis ? `<div style="padding: 12px ${pad}px; border-top: 2px solid {{t.rule}}">${analysis}</div>` : '';
  const btns = actions.map(t => phone ? btnGhost(t).replace('justify-content: center', 'justify-content: center; flex: 1 1 140px') : btnGhost(t)).join('');
  const analyze = analyzingNow ? btnOff('Analyzing\u2026') : btnGhost('Analyze Trade');
  const acts = `<div style="display: flex; flex-wrap: wrap; gap: 8px; padding: 12px ${pad}px; border-top: 2px solid {{t.rule}}">${btns}<span style="${phone ? 'flex: 1 1 140px; display: flex' : 'margin-left: auto'}">${phone ? analyze.replace('justify-content: center', 'justify-content: center; flex: 1') : analyze}</span></div>`;
  const cm = commish ? `<div role="group" aria-label="Commissioner" style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 12px ${pad}px; border-top: 2px solid {{t.rule}}"><span style="font-size: 13px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: {{t.dim}}; ${phone ? 'width: 100%' : 'width: 112px'}">Commissioner</span>${btnGhost('Force Approve')}${btnGhost('Commissioner Veto')}</div>` : '';
  const card = `<article aria-labelledby="${id}-h" data-testid="${id}" style="${FRAME2}; min-width: 0; flex: 1">${head}${cols}${an}${acts}${cm}</article>`;
  return cursor
    ? `<div class="cursor slot" style="--cur: {{t.cursor}}; padding: ${phone ? 0 : 4}px; border: 4px solid {{t.cursor}}; box-sizing: border-box; display: flex; flex-direction: column"><span style="${SR}">Next move: respond to this offer</span>${card}</div>`
    : `<div style="padding: ${phone ? 0 : 4}px; border: 4px solid transparent; box-sizing: border-box; display: flex; flex-direction: column">${card}</div>`;
}

// ---- alerts, toasts, empties ----
// The visual box holds the live region (role=alert: pictogram and words only) and, beside it, an optional Retry outside the region.
const alertBar = (text, { retry = false } = {}) => `<div style="box-sizing: border-box; border: 2px solid {{t.danger}}; background: {{t.panel}}; padding: 12px 16px; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; font-size: 16px"><div role="alert" style="flex: 1 1 240px; min-width: 0; display: flex; align-items: center; gap: 10px">${warn('{{t.danger}}')}<span style="text-wrap: pretty">${text}</span></div>${retry ? btnGhost('Retry') : ''}</div>`;
const toast = (text, { error = false } = {}) => `<div role="status" style="box-sizing: border-box; display: inline-flex; align-items: center; gap: 10px; min-height: 48px; padding: 0 16px; border: 2px solid ${error ? '{{t.danger}}' : '{{t.ink}}'}; background: {{t.panel}}; font-size: 15px; font-weight: 600">${error ? warn('{{t.danger}}') : checkIcon('currentColor')}${text}</div>`;
const emptyState = ({ id, title, text, tail = '' }) => `<section aria-labelledby="${id}" style="${FRAME2}; min-width: 0"><div style="padding: 32px 20px; display: flex; flex-direction: column; align-items: flex-start; gap: 8px">${h2s(id, title)}<p style="margin: 0; font-size: 16px; color: {{t.dim}}; max-width: 60ch; text-wrap: pretty">${text}</p>${tail}</div></section>`;

// ---- the propose / counter dialog ----
const POS_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const GRID = (phone) => `display: grid; grid-template-columns: 24px 40px minmax(0, 1fr) ${phone ? '56px 48px' : '72px 56px'}; align-items: center; gap: ${phone ? 8 : 10}px`;
// One roster column: players grouped in QB/RB/WR/TE/K/DEF order, one checkbox row each ("{name} ({position}) · weekly proj {n} · ROS {n}").
function rosterColumn({ label, players, checked = [], testId, phone = false }) {
  const sorted = [...players].sort((x, y) => POS_ORDER.indexOf(x.pos) - POS_ORDER.indexOf(y.pos));
  const head = `<div aria-hidden="true" style="${GRID(phone)}; font-size: 13px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: {{t.dim}}; line-height: 1.2; padding: 0 0 6px; border-bottom: 2px solid {{t.rule}}"><span></span><span></span><span></span><span style="text-align: right">Weekly proj</span><span style="text-align: right">ROS</span></div>`;
  const rows = sorted.map((p, i) => {
    const on = checked.includes(p.name), newGroup = i && sorted[i - 1].pos !== p.pos;
    const aria = `${p.name} (${p.pos}) · weekly proj ${p.wk}${p.ros != null ? ` · ROS ${p.ros}` : ''}`;
    return `<label style="${GRID(phone)}; min-height: 44px; cursor: pointer; ${i ? `border-top: ${newGroup ? '2px solid {{t.dim}}' : '2px solid {{t.rule}}'}` : ''}"><input type="checkbox" aria-label="${esc(aria)}"${on ? ' checked' : ''} style="${SR}"><span aria-hidden="true" style="display: grid; place-items: center; width: 24px; height: 24px; box-sizing: border-box; border: 2px solid {{t.ink}}; ${on ? 'background: {{t.ink}}; color: {{t.panel}}' : 'color: {{t.ink}}'}">${on ? '<svg width="12" height="12" viewBox="0 0 12 12" shape-rendering="crispEdges"><path d="M1 6h2v2H1zM3 8h2v2H3zM5 6h2v2H5zM7 4h2v2H7zM9 2h2v2H9z" fill="currentColor"/></svg>' : ''}</span>${posTag(p.pos)}<span style="font-size: 15px; font-weight: ${on ? 700 : 600}; min-width: 0; overflow-wrap: anywhere">${p.name}</span><span aria-hidden="true" style="text-align: right; font-size: 14px; color: {{t.dim}}">${p.wk.toFixed(1)}</span><span aria-hidden="true" style="text-align: right; font-size: 14px; color: {{t.dim}}">${p.ros.toFixed(1)}</span></label>`;
  }).join('');
  return `<div data-testid="${testId}" style="min-width: 0"><h3 style="margin: 0 0 8px; font-size: 16px; font-weight: 700">${label}</h3>${head}${rows}</div>`;
}
// "You send (2): [chip] [chip]" / "none selected".
const summaryRow = (label, names) => `<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px"><b style="font-size: 15px; font-weight: 700">${label} (${names.length}):</b>${names.length ? names.map(n => `<span style="display: inline-flex; align-items: center; height: 28px; padding: 0 10px; box-sizing: border-box; border: 2px solid {{t.rule}}; font-size: 14px; font-weight: 600">${n}</span>`).join('') : '<span style="font-size: 15px; color: {{t.dim}}">none selected</span>'}</div>`;

// body: columns etc. already built. phone: full width, no max-width (the product dialog is fullWidth below sm).
function tradeDialog({ id = 'td', title, teamSelect, send, receive, res, analyzingNow = false, sendNames, receiveNames, canSend, phone = false, alert = '', colsOverride = '' }) {
  const cols = colsOverride || (send ? `<div style="display: grid; grid-template-columns: ${phone ? '1fr' : 'minmax(0, 1fr) minmax(0, 1fr)'}; gap: ${phone ? 24 : 32}px">${send}${receive}</div>` : '');
  const an = analyzingNow ? analyzing() : res ? `<div style="border-top: 2px solid {{t.rule}}; padding-top: 16px">${analysisResult(res, { phone })}</div>` : '';
  const chips = send ? `<div style="display: flex; flex-direction: column; gap: 8px">${summaryRow('You send', sendNames)}${summaryRow('You receive', receiveNames)}</div>` : '';
  return `<div role="dialog" aria-modal="true" aria-labelledby="${id}-t" style="${FRAME}; width: 100%; max-width: ${phone ? 'none' : '900px'}; box-sizing: border-box; margin: 0 auto"><div style="padding: ${phone ? '12px 14px' : '14px 20px'}; border-bottom: 2px solid {{t.rule}}"><h2 id="${id}-t" style="margin: 0; ${px(16)}">${title}</h2></div><div style="padding: ${phone ? 14 : 20}px; display: flex; flex-direction: column; gap: 20px">${teamSelect}${cols}${an}${chips}${alert}</div><div style="display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 12px; padding: ${phone ? '12px 14px' : '14px 20px'}; border-top: 2px solid {{t.rule}}">${btnGhost('Cancel')}${canSend ? btnFill('Send Offer', { tag: 'button' }) : btnOff('Send Offer')}</div></div>`;
}
const teamSelect = ({ id, value, disabled = false, hint }) => k.select({ id, label: 'Trade with', options: [{ value: '', label: '' }, ...['Blitz Brigade', 'Waiver Wolves', 'Sunday Scaries', 'Gridiron Ghosts', 'Fumble Rooskie', 'Hail Mary Club', 'Pocket Aces', 'Dynasty Dads', 'Red Zone Rejects', 'Bench Mob', 'Practice Squad']], value: value || '', disabled, hint });

module.exports = {
  fmt1, ...k, page: k.page, LG, VIEWER, SUBLINE, DF, df, DADS, dads, WILSON, FLOWERS, WHITE, WADDLE, BROWN, SUTTON, GHOSTS_POS, WOLVES_POS, posOf, analyze, VERDICT, oppLabel, FACTOR, CAP,
  nameLink, btnOff, trHead, trTabs, tradeCard, analysisResult, analyzing, alertBar, toast, emptyState, rosterColumn, summaryRow, tradeDialog, teamSelect, leftArrow,
};

// ---- the fixture's trades (Sunday 9:10 AM, viewer Darkness Falls, commissioner) ----
const GHOSTS = 'Gridiron Ghosts', WOLVES = 'Waiver Wolves';
// Incoming (the cursor): Ghosts send Wilson, Darkness Falls sends Spears and Kincaid.
const A_SEND = [df('Tyjae Spears'), df('Dalton Kincaid')];
const A_RES = analyze([WILSON], A_SEND, GHOSTS_POS, posOf(DF));
// Outgoing: Darkness Falls sends Allgeier and Bigsby for Zay Flowers (BAL is on bye in Week 7).
const O_SEND = [df('Tyler Allgeier'), df('Tank Bigsby')];
// Counter: the incoming trade inverted, Darkness Falls is now the proposer.
const C_RES = analyze(A_SEND, [WILSON], posOf(DF), GHOSTS_POS);
// New offer to Dynasty Dads.
const P_SEND = [df('Jordan Addison'), df('Rome Odunze')], P_RECV = [dads('Malik Nabers')];
const P_RES = analyze(P_SEND, P_RECV, posOf(DF), posOf(DADS));
// Product checks the board relies on.
if (A_RES.verdict !== 'favors_proposer' || C_RES.verdict !== 'favors_receiver' || P_RES.verdict !== 'fair') throw new Error('analysis verdicts changed: ' + [A_RES.verdict, C_RES.verdict, P_RES.verdict]);
const O_RES = analyze(O_SEND, [FLOWERS], posOf(DF), WOLVES_POS);
if (O_RES.verdict !== 'fair') throw new Error('outgoing offer should read Fair: ' + O_RES.verdict);

// The Pending tab, in the API's order (newest first). id: the trade id the product's testid uses.
function pendingCards({ phone = false } = {}) {
  const base = { phone };
  return [
    tradeCard({ ...base, id: 'trade-12', a: GHOSTS, b: VIEWER, you: VIEWER, age: '2h ago', status: 'Pending', leftLabel: 'You Receive', left: [WILSON], rightLabel: `${GHOSTS} Receives`, right: A_SEND, analysis: analysisResult(A_RES, { phone }), actions: ['Accept Trade', 'Decline', 'Counter'], cursor: true }),
    tradeCard({ ...base, id: 'trade-11', a: 'Pocket Aces', b: 'Fumble Rooskie', age: '13h ago', status: 'Accepted', review: 'Sun 9:30 PM', leftLabel: 'Pocket Aces Receives', left: [WADDLE], rightLabel: 'Fumble Rooskie Receives', right: [WHITE], actions: ['Vote to Veto'], commish: true }),
    tradeCard({ ...base, id: 'trade-9', a: VIEWER, b: WOLVES, you: VIEWER, age: 'Sat 8:10 AM', status: 'Pending', leftLabel: 'You Receive', left: [FLOWERS], rightLabel: `${WOLVES} Receives`, right: O_SEND, actions: ['Cancel'] }),
  ];
}
Object.assign(module.exports, { GHOSTS, WOLVES, A_SEND, A_RES, O_SEND, O_RES, C_RES, P_SEND, P_RECV, P_RES, pendingCards });
