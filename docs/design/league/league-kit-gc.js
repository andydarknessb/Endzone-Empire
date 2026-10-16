// Pieces and fixture for the wave 2 Game Center boards (GameCenter, GameCenterPre, GameCenterPhone). Own file: never edit league-kit*.js.
// Product truth: E:/ee-ps-w2-read src/pages/game-center, widgets scoring-feed, nfl-game-strip, matchup-hero, matchup-grid, features/pick-week.
const k = require('./league-kit-matchup');
const W = require('./week7-games');
const P = require('./league-dash-parts');
const D = require('./lineup-data');
const { px, FRAME2, frameHead, h2, h2s, meta, avatar, youBadge, chip, liveChipBoard, arrow, clock, checkIcon, SR, esc } = k;
// kit.js paints the live bar with a literal hex; the board token is the same colour.
const oddsBar = (...a) => k.oddsBar(...a).replace(/#2fd97b/g, '{{t.boardLive}}');
const LG = 'Thursday Night Regulars';
const B = { ink: '{{t.boardInk}}', dim: '{{t.boardDim}}', rule: '{{t.boardRule}}' };
const f1 = n => n.toFixed(1);
const ORD = { 1: '1st', 2: '2nd', 3: '3rd' }, ord = n => ORD[n] || n + 'th';
const recOf = name => { const i = P.TEAMS.findIndex(t => t[0] === name), t = P.TEAMS[i]; return { rec: `${t[1]}-${t[2]}`, rank: ord(i + 1) }; };

// ---- fixture: one league world, Week 7 ----
const T = D.LIVE_TOTALS, S = D.SUMMARY;
// Main's 9:10 AM "Around the league" tiles (Main and MainPhone import this table; Game Center Pre reads the same): [[home, Proj], [away, Proj], home win probability %].
const AROUND_PRE = [
  [['Blitz Brigade', '118.2'], ['Bench Mob', '96.4'], 78],
  [['Waiver Wolves', '109.9'], ['Dynasty Dads', '101.3'], 63],
  [['Gridiron Ghosts', '107.1'], ['Hail Mary Club', '105.3'], 54],
  [['Pocket Aces', '103.1'], ['Fumble Rooskie', '99.8'], 59],
  [['Red Zone Rejects', '97.5'], ['Practice Squad', '88.2'], 68],
];
// Exp final per team at 2:40 PM (the live scores and win probability come from AROUND_LIVE).
const EF = { 'Blitz Brigade': 118.0, 'Bench Mob': 94.5, 'Waiver Wolves': 102.2, 'Dynasty Dads': 104.6, 'Gridiron Ghosts': 99.0, 'Hail Mary Club': 98.6, 'Pocket Aces': 108.0, 'Fumble Rooskie': 106.1, 'Red Zone Rejects': 99.6, 'Practice Squad': 84.9 };
// Players remaining (Critique 9 item 2) for the other ten teams: 9 starters minus those who do not count (a starter in Thursday's PIT @ CLE, which is final at both clocks; an Out starter; an empty slot). Darkness Falls and Sunday Scaries derive from lineup-data.js.
const NOT_COUNTED = {
  'Blitz Brigade': { pitCle: 1 }, 'Bench Mob': {}, 'Waiver Wolves': { out: 1 }, 'Dynasty Dads': {}, 'Gridiron Ghosts': { pitCle: 1 },
  'Hail Mary Club': { out: 1 }, 'Pocket Aces': { pitCle: 1 }, 'Fumble Rooskie': {}, 'Red Zone Rejects': {}, 'Practice Squad': { empty: 1 },
};
const toPlay = name => 9 - Object.values(NOT_COUNTED[name]).reduce((a, n) => a + n, 0);
// home is the left side. left = players remaining at 2:40 PM, leftPre at 9:10 AM (PIT @ CLE is final at both, so the other teams read the same).
const side = (name, score, ef, left, proj, leftPre) => ({ name, score, ef, left, proj, leftPre, ...recOf(name) });
if (AROUND_PRE.some(([a, b], i) => a[0] !== P.AROUND_LIVE[i].a.name || b[0] !== P.AROUND_LIVE[i].b.name)) throw new Error('AROUND_PRE and AROUND_LIVE disagree on the matchups');
const mk = (s, proj) => side(s.name, s.fig, EF[s.name], toPlay(s.name), +proj, toPlay(s.name));
const MATCHUPS = [
  { hero: true, home: side('Darkness Falls', T.meNow, T.meExp, T.meLeft, S.meProj, D.PRE_LEFT.me), away: side('Sunday Scaries', T.oppNow, T.oppExp, T.oppLeft, S.oppProj, D.PRE_LEFT.opp), pct: T.pct, prePct: S.pct, status: 'live', kick: 'Sun 12:00 PM' },
  ...P.AROUND_LIVE.map((t, i) => ({ home: mk(t.a, AROUND_PRE[i][0][1]), away: mk(t.b, AROUND_PRE[i][1][1]), pct: t.pct, prePct: AROUND_PRE[i][2], status: 'live', kick: 'Sun 12:00 PM' })),
];
const HERO = MATCHUPS[0], REST = MATCHUPS.slice(1);
HERO.away.yet = T.oppYet; // Critique 11 item 9: the opponent's starters whose game has not started at 2:40 PM (lineup-data.js, from week7-games.js)

// Game Center's NFL strip: every Sunday game of the one slate (week7-games.js) at the board's clock. At 2:40 PM eight are live.
const SUNDAY = W.GAMES.filter(g => g.window.startsWith('sunday'));
const IN_PROGRESS = W.GAMES.filter(g => W.stateAt(g, 240).status === 'live').length;

// Scoring plays held by the page, newest first. at = minutes after midnight; side = which side of the viewer's matchup (home = Darkness Falls).
const PLAYS = [
  { at: '2:38 PM', m: 14 * 60 + 38, name: 'J. Chase', nfl: 'CIN', type: 'receiving TD', pts: 12.1, team: 'Darkness Falls', side: 'home' },
  { at: '2:36 PM', m: 14 * 60 + 36, name: 'S. Barkley', nfl: 'PHI', type: 'rushing TD', pts: 9.4, team: 'Sunday Scaries', side: 'away' },
  { at: '2:27 PM', m: 14 * 60 + 27, name: 'K. Fairbairn', nfl: 'HOU', type: 'FIELD GOAL', pts: 3.0, team: 'Sunday Scaries', side: 'away' },
  { at: '2:19 PM', m: 14 * 60 + 19, name: 'J. Allen', nfl: 'BUF', type: 'INTERCEPTED', pts: -2.0, team: 'Darkness Falls', side: 'home' },
  { at: '2:12 PM', m: 14 * 60 + 12, name: 'A. St. Brown', nfl: 'DET', type: 'receiving TD', pts: 8.2, team: 'Sunday Scaries', side: 'away' },
  { at: '2:04 PM', m: 14 * 60 + 4, name: 'T. Hill', nfl: 'MIA', type: 'receiving TD', pts: 8.6, team: 'Sunday Scaries', side: 'away' },
  { at: '1:55 PM', m: 13 * 60 + 55, name: 'J. Gibbs', nfl: 'DET', type: 'rushing TD', pts: 9.1, team: 'Darkness Falls', side: 'home' },
  { at: '1:41 PM', m: 13 * 60 + 41, name: 'J. Cook', nfl: 'BUF', type: 'rushing TD', pts: 8.3, team: 'Sunday Scaries', side: 'away' },
  { at: '1:38 PM', m: 13 * 60 + 38, name: 'W. Marks', nfl: 'HOU', type: 'rushing TD', pts: 7.2, team: 'Darkness Falls', side: 'home' },
];
const sgn = n => (n < 0 ? '-' : '+') + Math.abs(n).toFixed(1);
const IDLE = 'Live scoring plays will appear here once games kick off.';

// Week at a glance: the product's weekGlanceFacts over the matchups.
function glanceFacts(ms, mode) {
  const started = mode === 'pre' ? [] : ms.filter(m => m.status !== 'scheduled');
  let top = null, closest = null, lead = null;
  for (const m of started) {
    for (const s of [m.home, m.away]) if (!top || s.score > top.score) top = { name: s.name, score: s.score };
    const margin = Math.round(Math.abs(m.home.score - m.away.score) * 10) / 10;
    if (!closest || margin < closest.margin) closest = { text: `${m.home.name} · ${m.away.name}`, margin };
    if (margin > 0 && (!lead || margin > lead.margin)) { const w = m.home.score > m.away.score; lead = { text: `${w ? m.home.name : m.away.name} over ${w ? m.away.name : m.home.name}`, margin }; }
  }
  const remaining = ms.reduce((a, m) => a + (mode === 'pre' ? m.home.leftPre + m.away.leftPre : m.home.left + m.away.left), 0);
  const rows = [];
  if (top) rows.push(['Top score', top.name, f1(top.score)]);
  if (closest) rows.push(['Closest', closest.text, f1(closest.margin)]);
  if (lead) rows.push(['Biggest lead', lead.text, f1(lead.margin)]);
  // Critique 11 item 9: live, the tile is "Players remaining" (a starter whose game is not final); before kickoff nothing is live, so it reads "Starters set to play" (Critique 10 item 12).
  rows.push([mode === 'pre' ? 'Starters set to play' : 'Players remaining', mode === 'pre' ? 'League-wide' : 'Starters league-wide', String(remaining)]);
  return rows;
}

// ---- small pieces ----
const dot = c => `<span aria-hidden="true" style="width: 8px; height: 8px; flex: none; background: ${c}"></span>`;
const syncLine = (text) => `<p style="margin: 0; display: flex; align-items: center; gap: 8px; font-size: 17px; color: {{t.dim}}">${clock('{{t.dim}}')}<span>${text}</span></p>`;
// Critique 9 item 3: the stamp is not older than the newest feed play (2:38 PM); non-breaking spaces keep each half whole so a phone never orphans a word.
const nbsp = t => t.replace(/ /g, '&nbsp;');
const LIVE_SYNC = `${nbsp('Scores synced 2:38 PM ·')} ${nbsp('next pass in 28 min')}`;
const PRE_SYNC = `${nbsp('Scores synced 8:55 AM ·')} ${nbsp('next pass in 15 min')}`;

// Week picker: previous, Wk 1..Wk 14 as a Play-select segmented control (selected = Play-blue fill + arrow + word), next, All weeks.
// Critique 10 item 10: one tab stop (roving tabindex, as Pick'em): the selected week is tabindex 0, every other week and Previous, Next, All weeks are -1; arrow keys move the selection.
const chev = d => `<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="${d}" fill="currentColor"/></svg>`;
const sq = (aria, d, off) => `<button type="button" tabindex="-1" aria-label="${aria}"${off ? ' disabled' : ''} style="flex: none; width: 44px; height: 44px; padding: 0; display: grid; place-items: center; box-sizing: border-box; border-radius: 0; background: transparent; border: 2px solid ${off ? '{{t.rule}}' : '{{t.ink}}'}; color: ${off ? '{{t.dim}}' : '{{t.ink}}'}">${chev(d)}</button>`;
function weekPicker({ phone = false, week = 7, weeks = 14 } = {}) {
  const from = phone ? 6 : 1; // a phone strip is scrolled so the selected week is in view
  const segs = Array.from({ length: weeks - from + 1 }, (_, i) => i + from).map((w, i) => {
    const on = w === week;
    return `<button type="button" role="radio" aria-checked="${on}" tabindex="${on ? 0 : -1}" style="flex: none; min-height: 44px; display: inline-flex; align-items: center; gap: 8px; padding: 0 14px; box-sizing: border-box; border-radius: 0; font-family: inherit; font-size: 15px; font-weight: 600; border: 2px solid ${on ? '{{t.play}}' : '{{t.ink}}'}; ${i ? 'margin-left: -2px; ' : ''}background: ${on ? '{{t.play}}' : 'transparent'}; color: ${on ? '{{t.playInk}}' : '{{t.ink}}'}">${on ? arrow() : ''}Wk ${w}</button>`;
  }).join('');
  const all = `<button type="button" tabindex="-1" aria-pressed="false" style="flex: none; min-height: 44px; padding: 0 16px; box-sizing: border-box; border-radius: 0; background: transparent; border: 2px solid {{t.ink}}; color: {{t.ink}}; font-family: inherit; font-size: 15px; font-weight: 600; white-space: nowrap">All weeks</button>`;
  return `<div role="group" aria-label="Week picker" style="display: flex; align-items: center; gap: ${phone ? 8 : 12}px; min-width: 0; ${phone ? 'width: 100%' : ''}">${sq('Previous week', 'M7 1h2v10H7zM5 3h2v6H5zM3 5h2v2H3z')}<div role="radiogroup" aria-label="Week" style="position: relative; display: flex; flex: 1 1 0; min-width: 0; ${phone ? '' : 'flex: none; width: 460px; '}overflow-x: auto; padding: 2px">${segs}</div>${sq('Next week', 'M3 1h2v10H3zM5 3h2v6H5zM7 5h2v2H7z')}${all}</div>`;
}

function head({ live, phone = false, sync }) {
  const crumbs = phone ? k.breadcrumbPhone(['Leagues', LG]) : k.breadcrumb(['Leagues', LG], 'Game Center');
  const title = `<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px 20px">${k.h1('Game Center', { phone })}${live ? k.liveChip('Live') : ''}</div>`;
  if (phone) return `<section aria-labelledby="h1" style="display: flex; flex-direction: column; gap: 12px; min-width: 0"><div style="display: flex; flex-direction: column; gap: 4px">${crumbs}${title}</div>${syncLine(sync)}${weekPicker({ phone })}${k.numbersHelp({ phone })}</section>`;
  // Critique 11 item 14: DOM order is visual order: title and sync, the week picker beside them, then the disclosure on its own row below.
  return `<section aria-labelledby="h1" style="display: flex; flex-direction: column; gap: 4px; min-width: 0">${crumbs}<div style="display: flex; align-items: center; justify-content: space-between; gap: 16px 24px"><div style="display: flex; flex-direction: column; gap: 12px; min-width: 0; flex: none">${title}${syncLine(sync)}</div>${weekPicker()}</div>${k.numbersHelp()}</section>`;
}

// ---- scoring strip ----
function playText(p, c) {
  return `<span style="display: inline-flex; align-items: baseline; gap: 8px; font-size: 14px"><strong style="font-weight: 700; color: ${c.ink}">${p.name}</strong> <span style="color: ${c.dim}">${p.nfl}</span> <span aria-hidden="true" style="color: ${c.dim}">·</span> <span style="color: ${c.dim}">${p.type}</span> <span aria-hidden="true" style="color: ${c.dim}">·</span> <b style="font-weight: 700; color: ${c.ink}">${sgn(p.pts)}</b> <span style="color: ${c.dim}">to ${p.team}</span></span>`;
}
function scoringStrip({ live, phone = false }) { // the desktop page does not draw it (Critique 11 item 12), so everything below is the phone strip
  const pageC = { ink: '{{t.ink}}', dim: '{{t.dim}}' };
  if (!live) return ''; // Critique 10 item 13: before kickoff the strip is not drawn; the Scoring feed card keeps the idle line
  if (!phone) return ''; // Critique 11 item 12: the desktop rail's Scoring feed shows the same plays; only the phone keeps the one-play strip, because its feed sits far below
  const plays = `<div style="flex: 1; min-width: 0; text-wrap: pretty">${playText(PLAYS[0], B).replace('display: inline-flex; align-items: baseline; gap: 8px', 'display: inline; line-height: 1.4')}</div>`;
  return `<section aria-label="Recent league scoring plays" style="display: flex; flex-direction: column; gap: 6px; padding: 12px 14px; box-sizing: border-box; background: {{t.board}}; color: ${B.ink}; border: 2px solid ${B.dim}; min-width: 0"><span style="flex: none; font-size: 13px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: ${B.dim}">Latest plays</span>${plays}</section>`;
}

// ---- NFL games strip ----
const nflStripGC = ({ live, phone = false }) => k.nflStrip(SUNDAY, { clock: live ? 240 : 9, phone });

// ---- hero: Your matchup ----
function heroSide(s, { right = false, lead, you, live, c, phone = false }) {
  const col = live ? (lead ? c.ink : c.dim) : c.ink;
  // Critique 10 item 14: on a phone the two sides sit side by side like MatchupPhone: name, record and rank, Pixel 24 figure, then the two stat lines, each half 1fr.
  if (phone) {
    const n = live ? s.left : s.leftPre, al = right ? 'text-align: right; align-items: flex-end' : 'align-items: flex-start';
    return `<div style="min-width: 0; display: flex; flex-direction: column; ${al}"><h3 style="margin: 0; ${px(16, col)}; line-height: 1.3; overflow-wrap: anywhere">${s.name}</h3><div style="display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin-top: 6px; font-size: 13px; color: ${c.dim}; ${right ? 'justify-content: flex-end' : ''}"><span style="font-variant-numeric: tabular-nums">${s.rec} · ${s.rank}</span>${you ? youBadge(c.ink) : ''}</div><div style="${px(24, col)}; line-height: 1.3; margin-top: 4px">${live ? f1(s.score) : f1(s.proj)}</div><div style="margin-top: 4px; font-size: 14px; line-height: 1.3; color: ${c.dim}">${live ? `<div>Expected final <b style="font-weight: 600; color: ${c.ink}; white-space: nowrap">${f1(s.ef)}</b></div>` : ''}<div>${live ? `${n} ${n === 1 ? 'player' : 'players'} remaining` : `${n} ${n === 1 ? 'starter' : 'starters'} set to play`}</div></div></div>`;
  }
  const nm = `<h3 style="margin: 0; min-width: 0; ${px(16, live ? col : c.ink)}; overflow-wrap: anywhere">${s.name}</h3>`;
  const id = `<div style="display: flex; align-items: center; gap: 10px; min-width: 0; ${right ? 'flex-direction: row-reverse; justify-content: flex-start' : ''}">${avatar(s.name, { size: 40, c: live ? col : c.ink })}${nm}${you ? youBadge(c.ink) : ''}</div>`;
  const line = `<div style="font-size: 14px; color: ${c.dim}; margin-top: 6px">${s.rec} · ${s.rank} in league</div>`;
  const figLabel = live ? '' : `<div style="font-size: 13px; color: ${c.dim}; margin-top: 14px">Proj</div>`;
  const fig = `<div style="${px(32, col)}; line-height: 1.2; margin-top: ${live ? 14 : 4}px">${live ? f1(s.score) : f1(s.proj)}</div>`;
  const n = live ? s.left : s.leftPre;
  const stats = `<div style="display: flex; flex-direction: column; gap: 2px; margin-top: 12px; font-size: 15px; color: ${c.ink}">${live ? `<div><span style="color: ${c.dim}">Expected final</span> <b style="font-weight: 600">${f1(s.ef)}</b></div>` : ''}<div>${live ? `${n} ${n === 1 ? 'player' : 'players'} remaining` : `${n} ${n === 1 ? 'starter' : 'starters'} set to play`}</div></div>`;
  return `<div style="min-width: 0; text-align: ${right ? 'right' : 'left'}">${id}${line}${figLabel}${fig}${stats}</div>`;
}
const nbForecast = '<span style="white-space: nowrap">Endzone Forecast</span>';
function heroSentence(h) {
  const lead = Math.round((h.home.score - h.away.score) * 10) / 10;
  const now = lead > 0 ? 'Ahead now' : lead < 0 ? 'Behind now' : 'Tied now';
  const gap = Math.round((h.home.ef - h.away.ef) * 10) / 10;
  const proj = gap > 0 ? `projected to lead by ${Math.abs(gap).toFixed(1)}` : `projected to trail by ${Math.abs(gap).toFixed(1)}`;
  const n = h.away.left;
  return `${now}, ${proj} · they have ${n} ${n === 1 ? 'player' : 'players'} remaining, ${h.away.yet} yet to play`;
}
const bLink = (label, aria) => `<a href="#" aria-label="${esc(aria)}" style="min-height: 44px; display: inline-flex; align-items: center; padding: 0 10px; font-size: 15px; font-weight: 600; color: ${B.ink}; text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 5px; text-decoration-color: ${B.dim}">${label}</a>`;
const bGhost = (label, aria, phone) => `<a href="#" aria-label="${esc(aria)}" style="min-height: 44px; display: inline-flex; align-items: center; justify-content: center; ${phone ? 'flex: 1;' : ''} padding: 0 16px; box-sizing: border-box; border: 2px solid ${B.ink}; color: ${B.ink}; font-size: 15px; font-weight: 600; text-decoration: none">${label}</a>`;

function heroLive({ phone = false } = {}) {
  const h = HERO, pad = phone ? 12 : 24;
  const lead = h.home.score >= h.away.score;
  const pcts = k.twoSided(h.home.name, h.away.name, h.pct, { on: 'board', caption: `Win probability · ${nbForecast}`, size: 14 });
  const facts = `<div style="display: flex; flex-wrap: wrap; gap: 4px 20px; font-size: 14px; color: ${B.dim}"><span style="display: inline-flex; align-items: center; gap: 8px">${dot('{{t.boardLive}}')}${IN_PROGRESS} games in progress</span></div>`;
  const actions = `<div style="display: flex; align-items: center; gap: 8px; ${phone ? 'width: 100%; flex-direction: column; align-items: stretch' : 'margin-left: auto'}">${phone ? '' : bLink('Matchup', `Matchup, ${h.home.name} against ${h.away.name}`)}${phone ? `<div style="display: flex; gap: 8px">${bGhost('Matchup', `Matchup, ${h.home.name} against ${h.away.name}`, true)}${bGhost('Set lineup', `Set lineup, ${LG}`, true)}</div>` : bGhost('Set lineup', `Set lineup, ${LG}`)}</div>`;
  const sides = phone
    ? `<div style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; align-items: start">${heroSide(h.home, { lead, you: true, live: true, c: B, phone })}${heroSide(h.away, { right: true, lead: !lead, live: true, c: B, phone })}</div>`
    : `<div style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 24px; align-items: start">${heroSide(h.home, { lead, you: true, live: true, c: B })}${heroSide(h.away, { right: true, lead: !lead, live: true, c: B })}</div>`;
  return `<section aria-labelledby="hero-h" style="display: flex; flex-direction: column; gap: ${phone ? 10 : 20}px; padding: ${pad}px; box-sizing: border-box; background: {{t.board}}; color: ${B.ink}; border: 6px double ${B.dim}; min-width: 0">
<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px">${phone ? `<div style="display: flex; flex-direction: column; gap: 4px; min-width: 0">${h2('hero-h', 'Your matchup', { phone })}${facts}</div>` : `${h2('hero-h', 'Your matchup', { phone })}<span style="font-size: 13px; color: ${B.dim}">Week 7</span>`}<span style="margin-left: auto">${liveChipBoard('Live')}</span></div>
<p aria-live="polite" style="margin: 0; ${SR}">${h.home.name} ${f1(h.home.score)}, ${h.away.name} ${f1(h.away.score)}</p>
${sides}
<div style="display: flex; flex-direction: column; gap: ${phone ? 6 : 10}px">${pcts}<p style="margin: 0; font-size: ${phone ? 14 : 15}px; text-wrap: pretty">${heroSentence(h)}</p></div>
${phone ? actions : `<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 4px 16px; padding-top: 12px; border-top: 2px solid ${B.rule}">${facts}${actions}</div>`}
</section>`;
}

function heroPre({ phone = false } = {}) {
  const h = HERO, c = { ink: '{{t.ink}}', dim: '{{t.dim}}' }, pad = phone ? 14 : 24;
  const sides = phone
    ? `<div style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; align-items: start">${heroSide(h.home, { you: true, c, phone })}${heroSide(h.away, { right: true, c, phone })}</div>`
    : `<div style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 24px; align-items: start">${heroSide(h.home, { you: true, c })}${heroSide(h.away, { right: true, c })}</div>`;
  const ghost = (label, aria) => `<a href="#" aria-label="${esc(aria)}" style="min-height: 44px; display: inline-flex; align-items: center; justify-content: center; ${phone ? 'flex: 1;' : ''} padding: 0 16px; box-sizing: border-box; border: 2px solid {{t.ink}}; color: {{t.ink}}; font-size: 15px; font-weight: 600; text-decoration: none">${label}</a>`;
  // Critique 10 item 9: the Ink two-sided bar (nothing is live before kickoff) and "Projected margin", as on MatchupPre.
  const trail = S.trail, marginText = trail > 0 ? `${h.away.name} by ${f1(trail)}` : `${h.home.name} by ${f1(-trail)}`;
  const margin = `<div style="display: flex; flex-direction: column; gap: 12px"><div style="font-size: 16px"><span style="color: {{t.dim}}">Projected margin ·</span> <b style="font-weight: 700">${k.nb(marginText)}</b></div>${k.twoSided(h.home.name, h.away.name, h.prePct, { on: 'page', caption: `Win probability · ${nbForecast}`, size: 14 })}</div>`;
  const matchupLink = `<a href="#" aria-label="Matchup, ${h.home.name} against ${h.away.name}" style="min-height: 44px; display: inline-flex; align-items: center; padding: 0 10px; font-size: 15px; font-weight: 600; color: {{t.ink}}; text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 5px; text-decoration-color: {{t.dim}}">Matchup</a>`;
  return `<section aria-labelledby="hero-h" style="${k.FRAME}; display: flex; flex-direction: column; box-sizing: border-box; min-width: 0">${frameHead(`${h2('hero-h', 'Your matchup', { phone })}<span style="font-size: 13px; color: {{t.dim}}">Week 7</span><span style="margin-left: auto">${chip('Scheduled')}</span>`, { phone })}
<div style="padding: ${pad}px; display: flex; flex-direction: column; gap: ${phone ? 16 : 20}px">${sides}
${margin}
<div style="display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 14px 0; border-top: 2px solid {{t.rule}}; border-bottom: 2px solid {{t.rule}}"><span style="font-size: 13px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: {{t.dim}}">Kickoff</span><span style="${px(phone ? 16 : 24)}; line-height: 1.3">${HERO.kick}</span></div>
<p style="margin: 0; display: flex; align-items: flex-start; gap: 8px; font-size: 14px; color: {{t.dim}}; text-wrap: pretty"><span style="margin-top: 2px; display: inline-flex">${k.warn('{{t.ink}}')}</span><span>${k.preNote().html}</span></p>
<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px"><span style="display: inline-flex; align-items: center; gap: 8px; font-size: 14px; color: {{t.dim}}">${clock('{{t.dim}}')}No games in progress</span><div style="${phone ? 'width: 100%; display: flex; gap: 8px' : 'margin-left: auto; display: flex; align-items: center; gap: 8px'}">${phone ? '' : matchupLink}${phone ? ghost('Matchup', `Matchup, ${h.home.name} against ${h.away.name}`) : ''}${ghost('Set lineup', `Set lineup, ${LG}`)}</div></div></div></section>`;
}

// ---- League matchups tiles ----
function tile(m, { live }) { // desktop only: the phone draws matchRow rows
  const a = m.home, b = m.away;
  const aria = !live ? `${a.name} against ${b.name}, projected ${f1(a.proj)} to ${f1(b.proj)}, ${a.name} ${m.prePct}%, ${b.name} ${100 - m.prePct}% win probability` : m.status === 'live' ? `${a.name} against ${b.name}, live, ${f1(a.score)} to ${f1(b.score)}, ${a.name} ${m.pct}%, ${b.name} ${100 - m.pct}% win probability`
    : m.status === 'final' ? `${a.name} against ${b.name}, final, ${f1(a.score)} to ${f1(b.score)}` : `${a.name} against ${b.name}, projected ${f1(a.proj)} to ${f1(b.proj)}, ${a.name} ${m.prePct}%, ${b.name} ${100 - m.prePct}% win probability`;
  const st = live ? m.status : 'sched';
  const board = st === 'live';
  const c = board ? B : { ink: '{{t.ink}}', dim: '{{t.dim}}' };
  const leadHome = a.score >= b.score;
  const row = (s, isLead) => {
    const col = st === 'sched' ? c.ink : isLead ? c.ink : c.dim;
    const n = st === 'live' ? s.left : s.leftPre;
    const note = `${st === 'live' ? `<div>Exp final ${f1(s.ef)}</div>` : ''}<div>${st === 'live' ? `${n} ${n === 1 ? 'player' : 'players'} remaining` : `${n} ${n === 1 ? 'starter' : 'starters'} set to play`}</div>`;
    const fig = st === 'sched' ? f1(s.proj) : f1(s.score);
    return `<div style="display: flex; align-items: center; gap: 10px; min-width: 0">${avatar(s.name, { c: col })}<div style="flex: 1; min-width: 0"><div style="font-size: 15px; font-weight: ${isLead && st !== 'sched' ? 700 : 600}; color: ${col}">${s.name} <span style="font-size: 13px; font-weight: 400; color: ${c.dim}">${s.rec}</span></div><div style="font-size: 13px; color: ${c.dim}">${note}</div></div>${st === 'final' && isLead ? `<span role="img" aria-label="Leading" style="color: {{t.ink}}; display: inline-flex">${checkIcon()}</span>` : ''}${fig ? `<span style="${px(16, col)}; flex: none">${fig}</span>` : ''}</div>`;
  };
  // Board black already says live (Critique 7): a live tile has no head row; final and awaiting-final tiles keep their state word.
  // Critique 10 item 13: before kickoff the tile has no "Scheduled" chip and no "Kicks off" line (the League matchups head says it once).
  const headRow = st === 'final' ? `<div style="display: flex; align-items: center; justify-content: flex-end">${chip('Final')}</div>` : '';
  const colHead = st === 'sched' ? `<span aria-hidden="true" style="align-self: flex-end; margin: -4px 0 -6px; font-size: 13px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: {{t.dim}}">Proj</span>` : '';
  const bar = `<div aria-hidden="true" style="height: 2px; background: ${st === 'live' ? B.rule : '{{t.rule}}'}"></div>`;
  const foot = `${k.twoSided(a.name, b.name, st === 'live' ? m.pct : m.prePct, { on: board ? 'board' : 'page' })}<div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 13px; color: ${c.dim}"><span>${st === 'final' ? 'Score of record' : ''}</span><span style="display: inline-flex; align-items: center; gap: 6px; font-weight: 600; color: ${c.ink}">Details${arrow()}</span></div>`;
  const shell = board ? `background: {{t.board}}; color: ${B.ink}; border: 2px solid ${B.dim}` : `background: {{t.panel}}; color: {{t.ink}}; border: 2px solid {{t.rule}}`;
  return `<a href="#" aria-label="${esc(aria)}" style="display: flex; flex-direction: column; gap: 12px; padding: 16px; box-sizing: border-box; height: 100%; ${shell}; text-decoration: none; min-width: 0">${headRow}${colHead}${row(a, leadHome)}${bar}${row(b, !leadHome)}${foot}</a>`;
}
// Phone: one row per matchup (Critique 7 item 6, Critique 9 item 5). Each side is its two-letter mark and full name (ellipsis) with its score, the leading side marked by a check and the word "Leading" (the viewer's own team is the hero, so it is never in this list), win probability naming its team, a Details cue.
function matchRow(m) {
  const a = m.home, b = m.away, leadHome = a.score >= b.score, fav = m.pct >= 50 ? a : b, favPct = m.pct >= 50 ? m.pct : 100 - m.pct;
  const aria = `${a.name} against ${b.name}, ${f1(a.score)} to ${f1(b.score)}, ${(leadHome ? a : b).name} leads, ${favPct}% win probability for ${fav.name}`;
  // Critique 9 item 5: the team's two-letter mark and its full name on one line, truncated with an ellipsis; the full names are in the accessible name.
  const line = (s, lead) => `<div style="display: flex; align-items: center; gap: 8px; min-width: 0; min-height: 28px">${avatar(s.name, { size: 24, c: lead ? B.ink : B.dim })}<span style="flex: 0 1 auto; min-width: 0; font-size: 15px; font-weight: ${lead ? 700 : 600}; color: ${lead ? B.ink : B.dim}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">${s.name}</span>${lead ? `<span style="flex: none; font-size: 13px; font-weight: 600; color: ${B.ink}; white-space: nowrap">Leads</span>` : ''}<span style="flex: 1"></span><span style="${px(16, lead ? B.ink : B.dim)}; flex: none; font-variant-numeric: tabular-nums">${f1(s.score)}</span></div>`;
  return `<a href="#" aria-label="${esc(aria)}" style="display: flex; flex-direction: column; gap: 4px; padding: 8px 12px; box-sizing: border-box; background: {{t.board}}; color: ${B.ink}; border: 2px solid ${B.dim}; text-decoration: none; min-width: 0"><div style="display: flex; flex-direction: column; gap: 2px; min-width: 0">${line(a, leadHome)}${line(b, !leadHome)}</div><div aria-hidden="true" style="display: flex; align-items: center; justify-content: space-between; gap: 12px; min-width: 0; font-size: 13px; color: ${B.dim}"><span style="min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis"><b style="font-weight: 700; color: ${B.ink}">${favPct}%</b> ${fav.name}</span><span style="flex: none; display: inline-flex; align-items: center; gap: 6px; font-weight: 600; color: ${B.ink}">Details${arrow()}</span></div></a>`;
}
function leagueMatchups({ live, phone = false }) {
  const meta2 = live ? meta('win probability · Endzone Forecast', phone ? 'width: 100%' : 'margin-left: auto') : meta(`All games kick off ${HERO.kick} · projected totals · win probability · Endzone Forecast`, phone ? 'width: 100%' : 'margin-left: auto');
  const grid = phone
    ? `<ul style="list-style: none; margin: 0; display: flex; flex-direction: column; gap: 8px; padding: 12px">${REST.map(m => `<li>${matchRow(m)}</li>`).join('')}</ul>`
    : `<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; padding: 16px">${REST.map(m => tile(m, { live })).join('')}</div>`;
  return `<section aria-labelledby="lm-h" style="${FRAME2}; min-width: 0">${frameHead(`${h2s('lm-h', 'League matchups')}${meta(`${REST.length} more`)}${meta2}`, { phone })}${grid}</section>`;
}

// ---- rail ----
function feedCard({ live, phone = false }) {
  const limit = phone ? 3 : 6, rows = PLAYS.slice(0, limit);
  const row = (p, i) => `<li style="display: flex; align-items: center; gap: 12px; padding: 10px ${phone ? 14 : 16}px; ${i ? 'border-top: 2px solid {{t.rule}}' : ''}"><span style="flex: none; width: 64px; font-size: 13px; color: {{t.dim}}; white-space: nowrap">${p.at}</span><div style="flex: 1; min-width: 0">${p.side ? `<span style="${SR}">${p.side === 'home' ? 'Home side' : 'Away side'}</span>` : ''}<div style="font-size: 15px"><b style="font-weight: 600">${p.name}</b> · ${p.type}</div><div style="font-size: 13px; color: {{t.dim}}">${p.nfl} · ${p.team}</div></div><b style="flex: none; font-size: 16px; font-weight: 700">${sgn(p.pts)}</b></li>`;
  const body = live
    ? `<ul style="list-style: none; margin: 0; padding: 0">${rows.map(row).join('')}</ul><div style="border-top: 2px solid {{t.rule}}; display: flex; justify-content: center"><button type="button" style="min-height: 44px; width: 100%; background: transparent; border: 0; border-radius: 0; color: {{t.ink}}; font-family: inherit; font-size: 15px; font-weight: 600; text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 5px; text-decoration-color: {{t.dim}}">Show all ${PLAYS.length} plays</button></div>`
    : `<p style="margin: 0; padding: ${phone ? 14 : 20}px; font-size: 15px; color: {{t.dim}}">${IDLE}</p>`;
  return `<section aria-labelledby="sf-h" style="${FRAME2}; min-width: 0">${frameHead(`${h2s('sf-h', 'Scoring feed')}${meta('Week 7')}`, { phone })}${body}</section>`;
}
function glanceCard({ live }) {
  const rows = glanceFacts(MATCHUPS, live ? 'live' : 'pre');
  return `<section aria-labelledby="wg-h" style="${FRAME2}; min-width: 0">${frameHead(h2s('wg-h', 'Week at a glance'))}<ul style="list-style: none; margin: 0; padding: 0 16px">${rows.map(([l, t, v], i) => `<li style="display: flex; align-items: center; gap: 12px; padding: 10px 0; ${i ? 'border-top: 2px solid {{t.rule}}' : ''}"><div style="flex: 1; min-width: 0; display: flex; flex-direction: column"><span style="font-size: 13px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: {{t.dim}}">${l}</span><span style="font-size: 15px; text-wrap: pretty">${t}</span></div><span style="${px(16)}; flex: none">${v}</span></li>`).join('')}</ul></section>`;
}

// ---- the page body ----
function body({ live, phone = false }) {
  const strips = `${scoringStrip({ live, phone })}${nflStripGC({ live, phone })}`;
  const main = `${live ? heroLive({ phone }) : heroPre({ phone })}${live ? k.lineupNote('live', phone) : ''}${leagueMatchups({ live, phone })}`;
  const rail = `${feedCard({ live, phone })}${phone ? '' : glanceCard({ live })}`;
  const sync = live ? LIVE_SYNC : PRE_SYNC;
  const grid = phone
    ? `<div style="display: flex; flex-direction: column; gap: 16px">${main}${rail}</div>`
    : `<div style="display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 24px; align-items: start"><div style="display: flex; flex-direction: column; gap: 24px; min-width: 0">${main}</div><div style="display: flex; flex-direction: column; gap: 24px; min-width: 0">${rail}</div></div>`;
  return { head: head({ live, phone, sync }), strips, grid };
}

module.exports = { ...k, AROUND_PRE, GC: { MATCHUPS, HERO, REST, SUNDAY, PLAYS, IN_PROGRESS, glanceFacts }, gcBody: body, gcHead: head };
